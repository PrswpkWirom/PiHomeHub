// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { clearApiCache } from "../hooks/useFetch";
import { resetAuthRequestGeneration } from "../api/client";
import { NotificationsPage } from "./NotificationsPage";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("NotificationsPage", () => {
  afterEach(() => {
    cleanup(); clearApiCache(); resetAuthRequestGeneration(); vi.unstubAllGlobals();
  });

  it("loads recent history, applies filters, and offers a retry on failure", async () => {
    let fail = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (fail) return new Response("unavailable", { status: 503 });
      if (path.includes("severity=critical")) return json({ items: [], next_before_id: null });
      return json({ items: [], next_before_id: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText("You’re all caught up")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "critical" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("severity=critical"))).toBe(true));

    fail = true;
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "service" } });
    expect(await screen.findByText("Notifications could not be loaded")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("You’re all caught up")).toBeTruthy();
  });

  it("keeps Newer navigation on an empty older page and resets filters for shortcuts", async () => {
    const notification = {
      id: 7, event_type: "service_failure", category: "service", severity: "warning",
      title: "Test service", message: "An infrastructure event", source_type: "service", source_id: "test",
      target_path: "/services", created_at: new Date().toISOString(), resolved_at: null, read_at: null
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("before_id=7")
      ? json({ items: [], next_before_id: null }) : json({ items: [notification], next_before_id: 7 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    await screen.findByText("Test service");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    await screen.findByText("You’re all caught up");
    expect((screen.getByRole("button", { name: "Newer" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Newer" }));
    await screen.findByText("Test service");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "service" } });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "warning" } });
    fireEvent.click(screen.getByRole("button", { name: "critical" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/notifications?limit=30&severity=critical")).toBe(true));
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("");
  });
});
