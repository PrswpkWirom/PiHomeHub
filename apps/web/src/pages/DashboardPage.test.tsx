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
  it("shows hardware identity and binary capacity without inventing unavailable speed", () => {
    overview({"/api/system/pi": { data: { cpu_percent: 10, memory_percent: 25, disk_percent: 50, temperature_c: 40, uptime_seconds: 3600,
      cpu_model: "Intel Core i5-8250U", cpu_logical_count: 8, memory_total_bytes: 8 * 1024 ** 3, memory_used_bytes: 2 * 1024 ** 3,
      memory_speed_mts: null, disk_total_bytes: 256 * 1024 ** 3, disk_used_bytes: 128 * 1024 ** 3 } }});
    expect(screen.getByText("Intel Core i5-8250U")).toBeDefined();
    expect(screen.getByText("8 logical processors")).toBeDefined();
    expect(screen.getByText("2 / 8 GiB used")).toBeDefined();
    expect(screen.getByText("128 / 256 GiB used")).toBeDefined();
    expect(screen.getByText("Speed unavailable")).toBeDefined();
  });
  it("shows configured speed and keeps older API responses usable", () => {
    overview({"/api/system/pi": { data: { cpu_percent: 0, memory_percent: 0, disk_percent: null, temperature_c: null, uptime_seconds: 1,
      memory_speed_mts: 3200, memory_total_bytes: 8 * 1024 ** 3, memory_used_bytes: 0 } }});
    expect(screen.getByText(/MT\/s configured/)).toBeDefined();
    expect(screen.getByText("0 / 8 GiB used")).toBeDefined();
    expect(screen.getByText("CPU model unavailable")).toBeDefined();
    expect(screen.getByText("Capacity unavailable")).toBeDefined();
  });
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
