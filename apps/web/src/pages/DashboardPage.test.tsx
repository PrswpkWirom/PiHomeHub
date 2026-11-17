// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ responses: {} as Record<string, unknown> }));
vi.mock("../components/snoopy-ascii-animation.js", () => ({ mountSnoopyAsciiAnimation: () => null }));
vi.mock("../components/AdminOnly", () => ({ usePermissions: () => ({ isAdmin: false }) }));
vi.mock("../hooks/useFetch", () => ({
  useFetch: (path: string) => ({ loading: false, refreshing: false, error: null, updatedAt: Date.now(), refetch: vi.fn(), ...(state.responses[path] ?? {}) })
}));
import { DashboardPage } from "./DashboardPage";

afterEach(cleanup);
function overview(overrides: Record<string, unknown> = {}) {
  state.responses = {
    "/api/system/pi": { data: { cpu_percent: 10, memory_percent: 20, disk_percent: 30, temperature_c: 0, uptime_seconds: 3600 } },
    "/api/devices": { data: [] },
    "/api/tailscale/devices": { data: [] },
    "/api/services/status": { data: [{ slug: "gitea", name: "Gitea", status: "running", health_status: null }] },
    "/api/services/links": { data: [] },
    "/api/tasks": { data: [] },
    ...overrides
  };
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}
describe("Dashboard status truth", () => {
  it("reports lifecycle without claiming an unchecked application is healthy", () => {
    overview();
    expect(screen.getByText("1 of 1 services running")).toBeDefined();
    expect(screen.queryByText(/services healthy|all systems operational/i)).toBeNull();
    expect(screen.getByText("0.0°C")).toBeDefined();
  });
  it("marks failed refreshes unavailable even when cached data exists", () => {
    overview({
      "/api/services/status": { data: [{ slug: "gitea", name: "Gitea", status: "running" }], error: "Connection lost" },
      "/api/tailscale/devices": { data: [], error: "Sync unavailable" }
    });
    expect(screen.getByText("Service status unavailable")).toBeDefined();
    expect(screen.getByText("Device status unavailable")).toBeDefined();
    expect(screen.queryByText(/No device is online right now/)).toBeNull();
  });
});
