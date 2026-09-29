import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, clearCsrfToken, resetAuthRequestGeneration, StaleRequestError } from "./client";

describe("API CSRF handling", () => {
  afterEach(() => {
    resetAuthRequestGeneration();
    clearCsrfToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures the login token and sends it on unsafe requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-from-login" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { "Content-Type": "application/json" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/api/auth/login", { username: "admin", password: "not-logged" });
    await api.post("/api/tasks", { title: "secured" });

    const mutationInit = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = mutationInit.headers as Headers;
    expect(mutationInit.credentials).toBe("include");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-from-login");
  });

  it("does not attach CSRF headers to safe requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/tasks");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).has("X-CSRF-Token")).toBe(false);
  });

  it("restores the private HTTP CSRF cookie after a page reload", async () => {
    vi.stubGlobal("document", { cookie: "pihomehub_private_csrf=private-token" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    await api.post("/api/notifications/read-all");
    expect((fetchMock.mock.calls[0][1].headers as Headers).get("X-CSRF-Token")).toBe("private-token");
  });

  it("requests password step-up when recent authentication has expired", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Recent authentication required" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(api.post("/api/services/adguard-home/actions/start")).rejects.toThrow(
      "Recent authentication required"
    );
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "pihomehub:recent-auth-required" }));
  });

  it("turns validation details into safe field feedback and omits submitted input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: [{ loc: ["body", "new_password"], msg: "String should have at least 12 characters", type: "string_too_short", input: "NEVER-ECHO" }]
    }), { status: 422, headers: { "Content-Type": "application/json" } })));

    const error: unknown = await api.post("/api/auth/change-password", { new_password: "NEVER-ECHO" }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.message).toContain("new_password: String should have at least 12 characters");
    expect(error.message).not.toContain("NEVER-ECHO");
    expect(error.validationErrors).toEqual([{
      loc: ["body", "new_password"],
      msg: "String should have at least 12 characters",
      type: "string_too_short"
    }]);
  });

  it("uses a generic error for non-JSON failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private traceback and submitted secret", { status: 500 })));

    const error: unknown = await api.get("/api/private").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.message).toBe("Request failed (500)");
    expect(error.message).not.toContain("private traceback");
  });

  it("does not mistake incorrect credentials for an expired session", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("CustomEvent", class { constructor(readonly type: string) {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Invalid username or password" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    })));

    await expect(api.post("/api/auth/login", { username: "admin", password: "wrong" })).rejects.toThrow("Invalid username or password");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("discards late responses without allowing an old CSRF token to replace the current one", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }))
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const oldRequest = api.get("/api/auth/me");
    resetAuthRequestGeneration();
    resolveFetch(new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "old-csrf-token" }
    }));

    await expect(oldRequest).rejects.toBeInstanceOf(StaleRequestError);
    await api.post("/api/tasks", { title: "new session" });
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers;
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });

  it("does not dispatch an expired-session event for a response from the previous login", async () => {
    let resolveFetch!: (response: Response) => void;
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("CustomEvent", class { constructor(readonly type: string) {} });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));

    const oldRequest = api.get("/api/auth/me");
    resetAuthRequestGeneration();
    resolveFetch(new Response(JSON.stringify({ detail: "Invalid or expired session" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(oldRequest).rejects.toBeInstanceOf(StaleRequestError);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
