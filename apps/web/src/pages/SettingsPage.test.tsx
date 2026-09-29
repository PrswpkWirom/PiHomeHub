// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const permissions = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("../components/AdminOnly", () => ({
  usePermissions: () => permissions
}));

import { SettingsAdminGuard } from "./SettingsPage";

function AdministratorScreen() {
  useEffect(() => {
    void fetch("/api/admin/audit-events/page");
  }, []);
  return <p>Private administrator data</p>;
}

describe("Settings administrator route guard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    permissions.isAdmin = false;
  });

  it("does not mount administrator screens or issue their requests for viewers", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><SettingsAdminGuard><AdministratorScreen /></SettingsAdminGuard></MemoryRouter>);

    expect(screen.getByText("Administrator access required")).toBeTruthy();
    expect(screen.queryByText("Private administrator data")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mounts administrator content for administrators", () => {
    permissions.isAdmin = true;
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><SettingsAdminGuard><AdministratorScreen /></SettingsAdminGuard></MemoryRouter>);

    expect(screen.getByText("Private administrator data")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/audit-events/page");
  });
});
