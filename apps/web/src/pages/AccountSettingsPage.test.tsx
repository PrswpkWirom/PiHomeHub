// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearCsrfToken, resetAuthRequestGeneration } from "../api/client";
import { AuthProvider } from "../contexts/AuthContext";
import { clearApiCache } from "../hooks/useFetch";
import { AccountSettingsPage } from "./SettingsSections";

describe("AccountSettingsPage", () => {
  afterEach(() => {
    cleanup();
    clearApiCache();
    resetAuthRequestGeneration();
    clearCsrfToken();
    vi.unstubAllGlobals();
  });

  it("shows the viewer role and labels the current session from the server flag", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      const body = path === "/api/auth/me"
        ? { id: 17, username: "viewer", is_admin: false, password_changed_at: "2026-08-01T12:00:00Z" }
        : [{
            id: 12,
            created_at: "2026-09-29T08:00:00Z",
            last_seen_at: "2026-09-29T08:30:00Z",
            expires_at: "2026-09-29T20:00:00Z",
            authentication_time: "2026-09-29T08:00:00Z",
            current: false,
            source_ip: null,
            user_agent: "Test browser"
          }, {
            id: 13,
            created_at: "2026-09-29T09:00:00Z",
            last_seen_at: "2026-09-29T09:30:00Z",
            expires_at: "2026-09-29T21:00:00Z",
            authentication_time: "2026-09-29T09:00:00Z",
            current: true,
            source_ip: "192.168.1.10",
            user_agent: null
          }];
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthProvider><MemoryRouter><AccountSettingsPage /></MemoryRouter></AuthProvider>);

    expect(await screen.findByText("viewer")).toBeTruthy();
    expect(screen.getByText("Viewer")).toBeTruthy();
    expect(await screen.findByText("This session")).toBeTruthy();
    expect(screen.getByText("Other session")).toBeTruthy();
    expect(screen.getByText("192.168.1.10")).toBeTruthy();
    expect(screen.getByText("Last recorded password update:", { exact: false })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Revoke session" })).toHaveLength(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const currentPassword = screen.getByLabelText("Current password") as HTMLInputElement;
    const newPassword = screen.getByLabelText(/^New password/) as HTMLInputElement;
    const confirmation = screen.getByLabelText("Confirm new password") as HTMLInputElement;
    fireEvent.change(currentPassword, { target: { value: "current-secret" } });
    fireEvent.change(newPassword, { target: { value: "A-new-secret-123!" } });
    fireEvent.change(confirmation, { target: { value: "A-different-secret-123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("The new passwords do not match.")).toBeTruthy();
    expect(confirmation.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("change-password"))).toBe(false);

    fireEvent.change(confirmation, { target: { value: "A-new-secret-123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("dialog", { name: "Change password?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(currentPassword.value).toBe("");
    expect(newPassword.value).toBe("");
    expect(confirmation.value).toBe("");
  });
});
