// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const permissions = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("../components/AdminOnly", () => ({ usePermissions: () => permissions }));

import { clearApiCache, invalidateCache } from "../hooks/useFetch";
import { resetAuthRequestGeneration } from "../api/client";
import type { ServiceOperation, ServiceStatus } from "../types/api";
import { ServicesPage } from "./ServicesPage";

function fixtureServices(): ServiceStatus[] {
  return ["adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"].map((slug) => ({
    slug,
    name: slug,
    status: "missing",
    detail: "Container not installed",
    host_ip: "100.64.1.2",
    host_ports: {},
    url: null,
    setup_required: slug === "mosquitto",
    operation: null,
    recent_operations: []
  }));
}

function operation(state: ServiceOperation["state"], stage: string): ServiceOperation {
  const now = new Date().toISOString();
  return {
    operation_id: "operation-adguard-create-0001",
    slug: "adguard-home",
    action: "create",
    state,
    stage,
    created_at: now,
    updated_at: now,
    finished_at: null,
    error_code: null,
    message: null
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function installApi(statuses: ServiceStatus[], submit?: (payload: { operation_id: string }) => void) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/services/status") return jsonResponse(statuses);
    if (url === "/api/services/capabilities") {
      return jsonResponse(statuses.map((service) => ({ slug: service.slug, actions: ["create", "start", "stop", "restart"], setup_required: service.setup_required })));
    }
    if (url === "/api/services/links") return jsonResponse([]);
    if (url === "/api/services/ports") return jsonResponse([]);
    if (url.endsWith("/actions/create") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { operation_id: string };
      submit?.(body);
      statuses[0].operation = operation("running", "downloading");
      return jsonResponse({
        slug: "adguard-home", action: "create", ok: true, message: "Service operation accepted.",
        operation: operation("running", "downloading")
      }, 202);
    }
    if (url.startsWith("/api/services/operations/")) return jsonResponse(operation("verifying", "verifying"));
    return jsonResponse({ detail: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Services page operation flow", () => {
  afterEach(() => {
    cleanup();
    clearApiCache();
    resetAuthRequestGeneration();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    permissions.isAdmin = true;
  });

  it("offers create for missing services and explains the Mosquitto prerequisite", async () => {
    installApi(fixtureServices());
    render(<ServicesPage />);

    expect((await screen.findAllByRole("button", { name: "Create and start" })).length).toBe(4);
    expect(screen.getByText(/Mosquitto.*credentials/i)).toBeTruthy();
  });

  it("shows a quick link when a service is running even with no saved links", async () => {
    const services = fixtureServices();
    services[0].status = "running";
    services[0].url = "http://100.65.234.44:3001";
    installApi(services);
    render(<ServicesPage />);

    const dashboards = await screen.findByText("Dashboards");
    const panel = dashboards.closest("section") ?? dashboards.parentElement?.parentElement;
    const link = within(panel as HTMLElement).getByRole("link", { name: /adguard-home/i }) as HTMLAnchorElement;
    expect(link.href).toBe("http://100.65.234.44:3001/");
    expect(screen.queryByText("No running service dashboards or saved links are available.")).toBeNull();
  });

  it("offers only Start for a stopped service", async () => {
    const services = fixtureServices();
    services[0].status = "exited";
    installApi(services);
    render(<ServicesPage />);

    const adguard = (await screen.findByText("adguard-home")).closest("article") as HTMLElement;
    expect(within(adguard).getByRole("button", { name: "Start" })).toBeTruthy();
    expect(within(adguard).queryByRole("button", { name: "Restart" })).toBeNull();
  });

  it("sends one stable operation ID and shows its current progress stage", async () => {
    const services = fixtureServices();
    const fetchMock = installApi(services);
    render(<ServicesPage />);
    const create = (await screen.findAllByRole("button", { name: "Create and start" }))[0];
    fireEvent.click(create);

    expect(await screen.findByText("Create · Downloading...", { exact: true })).toBeTruthy();
    await waitFor(() => {
      const submission = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/actions/create") && init?.method === "POST");
      expect(submission).toBeTruthy();
      const payload = JSON.parse(String(submission?.[1]?.body));
      expect(payload.operation_id).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    });
  });

  it("restores a running operation after the page reloads and disables conflicting controls", async () => {
    const services = fixtureServices();
    services[0].operation = operation("verifying", "verifying");
    installApi(services);
    render(<ServicesPage />);

    expect(await screen.findByText("Create · Verifying...", { exact: true })).toBeTruthy();
    const adguard = screen.getByText("adguard-home").closest("article");
    expect(adguard).not.toBeNull();
    const create = within(adguard as HTMLElement).getByRole("button", { name: "Create and start" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });
});

describe("Services page recovery", () => {
  afterEach(() => {
    cleanup();
    clearApiCache();
    resetAuthRequestGeneration();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    permissions.isAdmin = true;
  });

  it("reuses the same operation ID after a lost submission response", async () => {
    const services = fixtureServices();
    const submittedIds: string[] = [];
    let submissions = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/services/status") return jsonResponse(services);
      if (url === "/api/services/capabilities") return jsonResponse(services.map((service) => ({ slug: service.slug, actions: ["create", "start", "stop", "restart"], setup_required: service.setup_required })));
      if (url === "/api/services/links" || url === "/api/services/ports") return jsonResponse([]);
      if (url.startsWith("/api/services/operations/")) return jsonResponse({ detail: "Not found" }, 404);
      if (url.endsWith("/actions/create") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { operation_id: string };
        submittedIds.push(body.operation_id);
        submissions += 1;
        if (submissions === 1) throw new TypeError("connection lost after submit");
        services[0].operation = operation("running", "downloading");
        return jsonResponse({ slug: "adguard-home", action: "create", ok: true, message: "accepted", operation: services[0].operation }, 202);
      }
      return jsonResponse({ detail: "Not found" }, 404);
    }));
    render(<ServicesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Create and start" }))[0]);
    const check = await screen.findByRole("button", { name: "Check progress" });
    fireEvent.click(check);

    await waitFor(() => expect(submittedIds).toHaveLength(2));
    expect(submittedIds[1]).toBe(submittedIds[0]);
    expect(await screen.findByText("Create · Downloading...", { exact: true })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/connection lost after submit/)).toBeNull());
  });

  it("retains the last known status and labels it stale after a read failure", async () => {
    const services = fixtureServices();
    let statusReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/services/status") {
        statusReads += 1;
        return statusReads === 1 ? jsonResponse(services) : jsonResponse({ detail: "unavailable" }, 503);
      }
      if (url === "/api/services/capabilities") return jsonResponse(services.map((service) => ({ slug: service.slug, actions: ["create", "start", "stop", "restart"], setup_required: service.setup_required })));
      if (url === "/api/services/links" || url === "/api/services/ports") return jsonResponse([]);
      return jsonResponse({ detail: "Not found" }, 404);
    }));
    render(<ServicesPage />);
    expect(await screen.findByText("adguard-home")).toBeTruthy();
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByText(/Showing stale service status/)).toBeTruthy();
    expect(screen.getAllByText("Container not installed").length).toBeGreaterThan(0);
  });

  it("keeps service actions visible but disabled for non-administrators", async () => {
    permissions.isAdmin = false;
    installApi(fixtureServices());
    render(<ServicesPage />);

    const create = (await screen.findAllByRole("button", { name: "Create and start" }))[0] as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByText("Service controls require administrator access.")).toBeTruthy();
  });

  it("does not let a delayed older status response overwrite a newer one", async () => {
    const responses: Array<(response: Response) => void> = [];
    const services = fixtureServices();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/services/status") {
        return new Promise<Response>((resolve) => responses.push(resolve));
      }
      if (url === "/api/services/capabilities") return Promise.resolve(jsonResponse(services.map((service) => ({ slug: service.slug, actions: ["create", "start", "stop", "restart"], setup_required: service.setup_required }))));
      if (url === "/api/services/links" || url === "/api/services/ports") return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ detail: "Not found" }, 404));
    }));
    render(<ServicesPage />);
    await waitFor(() => expect(responses).toHaveLength(1));
    invalidateCache("/api/services/status");
    await waitFor(() => expect(responses).toHaveLength(2));
    const newest = fixtureServices();
    newest[0].status = "running";
    responses[1](jsonResponse(newest));
    expect(await screen.findByText("Application health: No health check configured")).toBeTruthy();
    responses[0](jsonResponse(fixtureServices()));
    await waitFor(() => expect(screen.getByText("Application health: No health check configured")).toBeTruthy());
  });
});
