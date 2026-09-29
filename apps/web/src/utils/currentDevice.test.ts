// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { TailscaleDevice } from "../types/api";
import { readSelectedDevice, resolveCurrentDevice } from "./currentDevice";

const device = (id: string, sync = "active") => ({ tailscale_id: id, sync_status: sync, display_name: "Renamed device" } as TailscaleDevice);

describe("current device selection", () => {
  it("prefers detected identity over a stale browser selection", () => {
    const devices = [device("a"), device("b")];
    expect(resolveCurrentDevice(devices, { tailscale_id: "a", method: "tailscale_ip" }, "b"))
      .toEqual({ device: devices[0], automatic: true });
  });
  it("keeps an explicit selection after a rename using the stable Tailscale ID", () => {
    const selected = device("a");
    expect(resolveCurrentDevice([selected], null, "a").device).toBe(selected);
  });
  it("does not select deleted or missing devices", () => {
    expect(resolveCurrentDevice([device("a", "missing_from_tailnet")], { tailscale_id: "a", method: "tailscale_ip" }, "a").device).toBeNull();
    expect(resolveCurrentDevice([device("b")], null, "a").device).toBeNull();
  });
  it("handles browsers that block local storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readSelectedDevice()).toBe("");
    spy.mockRestore();
  });
});
