import { afterEach, describe, expect, it, vi } from "vitest";

import { api, clearCsrfToken } from "./client";

describe("API CSRF handling", () => {
  afterEach(() => {
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
});
