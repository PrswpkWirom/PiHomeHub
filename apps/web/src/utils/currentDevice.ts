import type { CurrentTailscaleDevice, TailscaleDevice } from "../types/api";

export const CURRENT_DEVICE_STORAGE_KEY = "pihomehub-current-tailscale-device";

export function resolveCurrentDevice(
  devices: TailscaleDevice[], identity: CurrentTailscaleDevice | null, selectedId: string
) {
  const automatic = devices.find((device) =>
    device.sync_status === "active" && device.tailscale_id === identity?.tailscale_id
  );
  const selected = devices.find((device) =>
    device.sync_status === "active" && device.tailscale_id === selectedId
  );
  return { device: automatic ?? selected ?? null, automatic: Boolean(automatic) };
}

export function readSelectedDevice() {
  try { return window.localStorage.getItem(CURRENT_DEVICE_STORAGE_KEY) ?? ""; }
  catch { return ""; }
}
