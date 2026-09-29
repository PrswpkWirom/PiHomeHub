// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAuthRequestGeneration } from "../api/client";
import { ProtectedRoute } from "../layouts/ProtectedRoute";
import { clearApiCache } from "../hooks/useFetch";
import { AuthProvider } from "./AuthContext";

describe("AuthProvider session checks", () => {
  afterEach(() => {
    cleanup();
    resetAuthRequestGeneration();
    clearApiCache();
    vi.unstubAllGlobals();
  });

  it("keeps session state unresolved and offers retry after a network failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 42,
        username: "admin",
        is_admin: true,
        password_changed_at: null
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthProvider><MemoryRouter><ProtectedRoute><p>Authenticated workspace</p></ProtectedRoute></MemoryRouter></AuthProvider>);

    expect(await screen.findByText("PiHomeHub could not verify the sign-in session. Check the connection and retry.")).toBeTruthy();
    expect(screen.queryByText("Authenticated workspace")).toBeNull();
    expect(screen.queryByText("Sign in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));

    expect(await screen.findByText("Authenticated workspace")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
