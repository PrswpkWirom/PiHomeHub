import { FormEvent, useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { DeviceSummary, DeviceWrite, TailscaleDevice, TailscaleWolWrite } from "../types/api";

const emptyManualDevice: DeviceWrite = {
  name: "",
  device_type: "desktop",
  ip_address: "",
  tailscale_name: "",
  mac_address: "",
  supports_wol: false,
  description: ""
};

const TAILSCALE_REFRESH_MS = 60_000;

let lastTailscaleSyncCompletedAt: number | null = null;
let lastTailscaleSyncLabel: string | null = null;
let tailscaleSyncPromise: Promise<TailscaleDevice[]> | null = null;

function cleanDevice(payload: DeviceWrite): DeviceWrite {
  return {
    ...payload,
    ip_address: payload.ip_address || null,
    tailscale_name: payload.tailscale_name || null,
    mac_address: payload.mac_address || null,
    description: payload.description || null
  };
}

function canWake(device: TailscaleDevice) {
  return device.supports_wol && Boolean(device.mac_address);
}

function hasRecentTailscaleSync(devices: TailscaleDevice[]) {
  if (lastTailscaleSyncCompletedAt && Date.now() - lastTailscaleSyncCompletedAt < TAILSCALE_REFRESH_MS) {
    return true;
  }
  return devices.some((device) => {
    if (!device.last_synced_at) {
      return false;
    }
    const syncedAt = Date.parse(device.last_synced_at);
    return Number.isFinite(syncedAt) && Date.now() - syncedAt < TAILSCALE_REFRESH_MS;
  });
}

export function DevicesPage() {
  const manual = useFetch<DeviceSummary[]>("/api/devices");
  const tailscale = useFetch<TailscaleDevice[]>("/api/tailscale/devices");
  const [manualForm, setManualForm] = useState<DeviceWrite>(emptyManualDevice);
  const [editingManualId, setEditingManualId] = useState<number | null>(null);
  const [editingTailscaleId, setEditingTailscaleId] = useState<number | null>(null);
  const [wolForm, setWolForm] = useState<TailscaleWolWrite>({ supports_wol: false });
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(lastTailscaleSyncLabel);
  const setTailscaleData = tailscale.setData;

  const syncTailscale = useCallback(async ({ silent = false, force = false }: { silent?: boolean; force?: boolean } = {}) => {
    if (silent && tailscaleSyncPromise) {
      return;
    }
    if (!force && lastTailscaleSyncCompletedAt && Date.now() - lastTailscaleSyncCompletedAt < TAILSCALE_REFRESH_MS) {
      return;
    }
    if (!silent) {
      setMessage(null);
    }
    setSyncing(true);
    try {
      const request = tailscaleSyncPromise ?? api.post<TailscaleDevice[]>("/api/tailscale/sync");
      tailscaleSyncPromise = request;
      const synced = await request;
      setTailscaleData(synced);
      const timestamp = new Date().toLocaleTimeString();
      lastTailscaleSyncCompletedAt = Date.now();
      lastTailscaleSyncLabel = timestamp;
      setLastSyncAt(timestamp);
      if (!silent) {
        setMessage(`Synced ${synced.length} Tailscale devices at ${timestamp}.`);
      }
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : "Tailscale sync failed.");
      }
    } finally {
      tailscaleSyncPromise = null;
      setSyncing(false);
    }
  }, [setTailscaleData]);

  useEffect(() => {
    if (!tailscale.loading && tailscale.data !== null && !hasRecentTailscaleSync(tailscale.data)) {
      void syncTailscale({ silent: true });
    }
  }, [syncTailscale, tailscale.data, tailscale.loading]);

  const saveManual = async (event: FormEvent) => {
    event.preventDefault();
    const payload = cleanDevice(manualForm);
    if (editingManualId) {
      const updated = await api.patch<DeviceSummary>(`/api/devices/${editingManualId}`, payload);
      manual.setData((current) => (current ?? []).map((device) => (device.id === editingManualId ? updated : device)));
    } else {
      const created = await api.post<DeviceSummary>("/api/devices", payload);
      manual.setData((current) => [...(current ?? []), created]);
    }
    setManualForm(emptyManualDevice);
    setEditingManualId(null);
  };

  const editManual = (device: DeviceSummary) => {
    if (!device.id) {
      return;
    }
    setEditingManualId(device.id);
    setManualForm({
      name: device.name,
      device_type: device.device_type,
      ip_address: device.ip_address ?? "",
      tailscale_name: device.tailscale_name ?? "",
      mac_address: device.mac_address ?? "",
      supports_wol: device.supports_wol,
      description: device.description ?? ""
    });
  };

  const deleteManual = async (deviceId: number) => {
    await api.delete(`/api/devices/${deviceId}`);
    manual.setData((current) => (current ?? []).filter((device) => device.id !== deviceId));
  };

  const configureWol = (device: TailscaleDevice) => {
    setEditingTailscaleId(device.id);
    setWolForm({
      supports_wol: device.supports_wol,
      mac_address: device.mac_address ?? "",
      lan_ip_address: device.lan_ip_address ?? "",
      broadcast_address: device.broadcast_address ?? "",
      alias: device.alias ?? "",
      note: device.note ?? ""
    });
  };

  const saveTailscaleWol = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingTailscaleId) {
      return;
    }
    const updated = await api.patch<TailscaleDevice>(`/api/tailscale/devices/${editingTailscaleId}/wol`, {
      supports_wol: wolForm.supports_wol,
      mac_address: wolForm.mac_address || null,
      lan_ip_address: wolForm.lan_ip_address || null,
      broadcast_address: wolForm.broadcast_address || null,
      alias: wolForm.alias || null,
      note: wolForm.note || null
    });
    tailscale.setData((current) => (current ?? []).map((device) => (device.id === editingTailscaleId ? updated : device)));
    setEditingTailscaleId(null);
    setWolForm({ supports_wol: false });
  };

  const wakeTailscale = async (device: TailscaleDevice) => {
    try {
      await api.post(`/api/tailscale/devices/${device.id}/wake`);
      setMessage(`Wake packet sent to ${device.machine_name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wake failed.");
    }
  };

  return (
    <div className="grid gap-6">
      <Panel
        title="Tailscale Devices"
        action={
          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-slate-500">
            <span>{lastSyncAt ? `Last sync ${lastSyncAt}` : "Background sync after load"}</span>
            <button
              className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
              disabled={syncing}
              onClick={() => void syncTailscale({ force: true })}
            >
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          </div>
        }
      >
        {tailscale.loading ? <p>Loading Tailscale devices...</p> : null}
        {tailscale.error ? <p className="text-red-700">{tailscale.error}</p> : null}
        <div className="space-y-4">
          {tailscale.data?.map((device) => (
            <div key={device.id} className="grid gap-4 rounded-3xl bg-clay p-5 xl:grid-cols-[1.1fr_1fr_0.8fr] xl:items-center">
              <div>
                <p className="font-semibold text-ink">{device.machine_name}</p>
                <p className="text-sm text-slate-600">{device.hostname ?? "No hostname"} · {device.os ?? "Unknown OS"}</p>
                <p className="mt-1 break-all text-sm text-slate-500">{device.tailscale_ips.join(", ") || "No Tailscale address"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={device.online ? "online" : "offline"} />
                <StatusPill status={device.sync_status} />
                <span className="text-sm text-slate-500">Last seen: {device.last_seen ?? "Unknown"}</span>
              </div>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <button className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink" onClick={() => configureWol(device)}>
                  Configure WOL
                </button>
                <button className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!canWake(device)} onClick={() => void wakeTailscale(device)}>
                  Wake
                </button>
              </div>
            </div>
          ))}
          {tailscale.data?.length === 0 ? <p className="text-sm text-slate-600">No Tailscale devices synced yet. Add the API token in Settings and run sync.</p> : null}
        </div>
        {editingTailscaleId ? (
          <form className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-white p-5" onSubmit={saveTailscaleWol}>
            <label className="flex items-center gap-3 text-sm font-semibold text-ink">
              <input type="checkbox" checked={wolForm.supports_wol} onChange={(event) => setWolForm({ ...wolForm, supports_wol: event.target.checked })} />
              Supports Wake-on-LAN
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="MAC address" value={wolForm.mac_address ?? ""} onChange={(event) => setWolForm({ ...wolForm, mac_address: event.target.value })} />
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="LAN IP address" value={wolForm.lan_ip_address ?? ""} onChange={(event) => setWolForm({ ...wolForm, lan_ip_address: event.target.value })} />
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Broadcast address" value={wolForm.broadcast_address ?? ""} onChange={(event) => setWolForm({ ...wolForm, broadcast_address: event.target.value })} />
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Alias" value={wolForm.alias ?? ""} onChange={(event) => setWolForm({ ...wolForm, alias: event.target.value })} />
            </div>
            <textarea className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Note" value={wolForm.note ?? ""} onChange={(event) => setWolForm({ ...wolForm, note: event.target.value })} />
            <div className="flex gap-2">
              <button className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">Save WOL</button>
              <button className="rounded-full border border-ink px-5 py-3 text-sm font-semibold text-ink" type="button" onClick={() => setEditingTailscaleId(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </Panel>

      <Panel title="Manual Devices">
        {manual.loading ? <p>Loading devices...</p> : null}
        {manual.error ? <p className="text-red-700">{manual.error}</p> : null}
        <form className="mb-5 grid gap-3 rounded-3xl border border-slate-200 bg-white p-5" onSubmit={saveManual}>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Name" value={manualForm.name} onChange={(event) => setManualForm({ ...manualForm, name: event.target.value })} required />
            <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Device type" value={manualForm.device_type} onChange={(event) => setManualForm({ ...manualForm, device_type: event.target.value })} />
            <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Local IP" value={manualForm.ip_address ?? ""} onChange={(event) => setManualForm({ ...manualForm, ip_address: event.target.value })} />
            <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Tailscale name" value={manualForm.tailscale_name ?? ""} onChange={(event) => setManualForm({ ...manualForm, tailscale_name: event.target.value })} />
            <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="MAC address" value={manualForm.mac_address ?? ""} onChange={(event) => setManualForm({ ...manualForm, mac_address: event.target.value })} />
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-ink">
              <input type="checkbox" checked={manualForm.supports_wol} onChange={(event) => setManualForm({ ...manualForm, supports_wol: event.target.checked })} />
              Supports WOL
            </label>
          </div>
          <textarea className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Description" value={manualForm.description ?? ""} onChange={(event) => setManualForm({ ...manualForm, description: event.target.value })} />
          <div className="flex gap-2">
            <button className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">{editingManualId ? "Save Device" : "Add Device"}</button>
            {editingManualId ? (
              <button className="rounded-full border border-ink px-5 py-3 text-sm font-semibold text-ink" type="button" onClick={() => { setEditingManualId(null); setManualForm(emptyManualDevice); }}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <div className="space-y-4">
          {manual.data?.map((device) => (
            <div key={`${device.name}-${device.id ?? "local"}`} className="grid gap-2 rounded-3xl bg-clay p-5 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:items-center">
              <div>
                <p className="font-semibold text-ink">{device.name}</p>
                <p className="text-sm text-slate-600">{device.device_type}</p>
              </div>
              <div className="text-sm text-slate-600">
                <p>{device.ip_address ?? "No IP configured"}</p>
                <p>{device.tailscale_name ?? "No Tailscale host"}</p>
              </div>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <StatusPill status={device.status} />
                {device.id ? (
                  <>
                    <button className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink" onClick={() => editManual(device)}>
                      Edit
                    </button>
                    <button className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700" onClick={() => void deleteManual(device.id!)}>
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
