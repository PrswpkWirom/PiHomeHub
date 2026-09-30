import { describe, expect, it } from "vitest";

import { dashboardLinks, resolveServiceLinkUrl } from "./serviceLinks";
import type { ServiceLink, ServiceStatus } from "../types/api";

function locationFor(url: string) {
  return new URL(url) as unknown as Location;
}

describe("resolveServiceLinkUrl", () => {
  it("uses the dashboard host for seeded pi.local service links", () => {
    expect(resolveServiceLinkUrl("http://pi.local:3001", locationFor("http://192.168.1.136:5173"))).toBe(
      "http://192.168.1.136:3001/"
    );
  });

  it("keeps pi.local when the dashboard is opened through pi.local", () => {
    expect(resolveServiceLinkUrl("http://pi.local:3004", locationFor("http://pi.local:5173"))).toBe(
      "http://pi.local:3004/"
    );
  });

  it("leaves external service links unchanged", () => {
    expect(resolveServiceLinkUrl("https://example.com/service", locationFor("http://192.168.1.136:5173"))).toBe(
      "https://example.com/service"
    );
  });
});


describe("dashboardLinks", () => {
  const adguard: ServiceStatus = {
    slug: "adguard-home", name: "Adguard Home", status: "running", detail: "Running",
    host_ip: "100.65.234.44", host_ports: { web: 3001 }, url: "http://100.65.234.44:3001",
    setup_required: false, operation: null, recent_operations: []
  };
  const saved: ServiceLink[] = [
    { id: 8, slug: "adguard-home", name: "Old AdGuard link", url: "http://pi.local:9999", description: null },
    { id: 9, slug: "home-assistant", name: "Home Assistant", url: "https://example.com", description: null }
  ];

  it("shows a running service automatically and uses its current port over an old saved URL", () => {
    const result = dashboardLinks(saved, [adguard]);
    expect(result).toHaveLength(2);
    expect(result.find((link) => link.slug === "adguard-home")?.url).toBe("http://100.65.234.44:3001");
    expect(result.find((link) => link.slug === "home-assistant")?.url).toBe("https://example.com");
  });

  it("does not invent a link for an uninstalled or stopped service", () => {
    expect(dashboardLinks([], [{ ...adguard, status: "missing" }, { ...adguard, status: "exited" }])).toEqual([]);
  });
});

it("keeps an explicit HTTPS override when runtime reports HTTP", () => {
  const saved: ServiceLink = { id: 1, slug: "vaultwarden", name: "Vaultwarden", url: "https://vault.home/vault", description: null, url_override: true };
  const runtime = { slug: "vaultwarden", name: "Vaultwarden", status: "running", url: "http://100.64.1.2:3004" } as ServiceStatus;
  expect(dashboardLinks([saved], [runtime])).toEqual([saved]);
});
