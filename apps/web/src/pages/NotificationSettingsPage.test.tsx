// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { clearApiCache } from "../hooks/useFetch";
import { resetAuthRequestGeneration } from "../api/client";
import { NotificationSettingsPage } from "./SettingsSections";

const initial = {
  device_offline: true, device_recovered: true, service_failure: true, service_recovered: true,
  temperature: true, disk: true, memory: true, monitoring: true, tailscale_sync: true
};

describe("NotificationSettingsPage", () => {
  afterEach(() => { cleanup(); clearApiCache(); resetAuthRequestGeneration(); vi.unstubAllGlobals(); });

  it("loads and saves per-account event preferences", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify(JSON.parse(String(init.body))), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify(initial), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationSettingsPage />);
    const deviceOffline = await screen.findByRole("checkbox", { name: "Device went offline" });
    expect((deviceOffline as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect((deviceOffline as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(deviceOffline);
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const mutation = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(mutation?.body)).device_offline).toBe(false);
    expect(await screen.findByText("Notification preferences saved.")).toBeTruthy();
  });
});
