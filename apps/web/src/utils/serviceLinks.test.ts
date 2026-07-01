import { describe, expect, it } from "vitest";

import { resolveServiceLinkUrl } from "./serviceLinks";

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
