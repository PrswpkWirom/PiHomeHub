// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { clearApiCache } from "../hooks/useFetch";
import { resetAuthRequestGeneration } from "../api/client";
import { NotificationControl } from "./NotificationControl";

const item = {
  id: 3, event_type: "service_failure", category: "service", severity: "critical",
  title: "Vaultwarden stopped", message: "Service has remained stopped for three checks.",
  source_type: "service", source_id: "vaultwarden", target_path: "/services",
  created_at: new Date().toISOString(), resolved_at: null, read_at: null
};

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("NotificationControl", () => {
  afterEach(() => {
    cleanup();
    clearApiCache();
    resetAuthRequestGeneration();
    vi.unstubAllGlobals();
  });

  it("caps the badge, opens recent events, and marks an event read", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("unread-count")) return json({ count: 100 });
      if (init?.method === "PATCH") return new Response(null, { status: 204 });
      if (path.includes("notifications?limit=10")) return json({ items: [item], next_before_id: null });
      return json({ count: 99 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><NotificationControl /></MemoryRouter>);
    const bell = await screen.findByRole("button", { name: "Notifications, 100 unread" });
    expect(screen.getByText("99+")).toBeTruthy();
    fireEvent.click(bell);
    expect(await screen.findByRole("dialog", { name: "Recent notifications" })).toBeTruthy();
    expect(screen.getByText("Vaultwarden stopped")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark Vaultwarden stopped as read" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("unread-count")).length).toBeGreaterThan(1));
  });

  it("shows an empty state and a retryable load error", async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("unread-count")) return json({ count: 0 });
      if (fail) return new Response(JSON.stringify({ detail: "Unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
      return json({ items: [], next_before_id: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><NotificationControl /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Notifications could not be loaded.")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("You’re all caught up.")).toBeTruthy();
  });
});
