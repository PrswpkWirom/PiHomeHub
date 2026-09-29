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
});
