import { FormEvent, useCallback, useEffect, useState } from "react";
import { Edit3, Power, RefreshCw, Settings2, Trash2, X } from "lucide-react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { DeviceSummary, DeviceWrite, TailscaleDevice, TailscaleDeviceSettingsWrite } from "../types/api";

const emptyManualDevice: DeviceWrite = {
  name: "",
  device_type: "desktop",
  ip_address: "",
  tailscale_name: "",
  mac_address: "",
  supports_wol: false,
  description: ""
};

const emptyTailscaleSettings: TailscaleDeviceSettingsWrite = {
  display_name: "",
  supports_wol: false,
  mac_address: "",
  lan_ip_address: "",
  broadcast_address: "",
  note: ""
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

function detailValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "None";
  }
  return value || "None";
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
    </div>
  );
}

export function DevicesPage() {
  const manual = useFetch<DeviceSummary[]>("/api/devices");
  const tailscale = useFetch<TailscaleDevice[]>("/api/tailscale/devices");
  const [manualForm, setManualForm] = useState<DeviceWrite>(emptyManualDevice);
  const [editingManualId, setEditingManualId] = useState<number | null>(null);
  const [editingTailscaleId, setEditingTailscaleId] = useState<number | null>(null);
  const [settingsForm, setSettingsForm] = useState<TailscaleDeviceSettingsWrite>(emptyTailscaleSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(lastTailscaleSyncLabel);
  const setTailscaleData = tailscale.setData;
  const editingTailscaleDevice = tailscale.data?.find((device) => device.id === editingTailscaleId) ?? null;

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

  const openTailscaleSettings = (device: TailscaleDevice) => {
    setEditingTailscaleId(device.id);
    setSettingsForm({
      display_name: device.alias ?? "",
      supports_wol: device.supports_wol,
      mac_address: device.mac_address ?? "",
      lan_ip_address: device.lan_ip_address ?? "",
      broadcast_address: device.broadcast_address ?? "",
      note: device.note ?? ""
    });
  };

  const closeTailscaleSettings = () => {
    setEditingTailscaleId(null);
    setSettingsForm(emptyTailscaleSettings);
  };

  const saveTailscaleSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingTailscaleId) {
      return;
    }
    const updated = await api.patch<TailscaleDevice>(`/api/tailscale/devices/${editingTailscaleId}/settings`, {
      display_name: settingsForm.display_name || null,
      supports_wol: settingsForm.supports_wol,
      mac_address: settingsForm.mac_address || null,
      lan_ip_address: settingsForm.lan_ip_address || null,
      broadcast_address: settingsForm.broadcast_address || null,
      note: settingsForm.note || null
    });
    tailscale.setData((current) => (current ?? []).map((device) => (device.id === editingTailscaleId ? updated : device)));
    closeTailscaleSettings();
  };

  const wakeTailscale = async (device: TailscaleDevice) => {
    try {
      await api.post(`/api/tailscale/devices/${device.id}/wake`);
      setMessage(`Wake packet sent to ${device.display_name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wake failed.");
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h1 className="page-title">Devices</h1>
          <p className="page-copy">Tailscale nodes and manually managed LAN devices share one operational view.</p>
        </div>
      </div>
      <Panel
        title="Tailscale devices"
        description="Synced from the Tailscale API. Device settings stay editable inline so the list remains visible."
        action={
          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>{lastSyncAt ? `Last sync ${lastSyncAt}` : "Background sync after load"}</span>
            <button
              className="btn-secondary"
              disabled={syncing}
              onClick={() => void syncTailscale({ force: true })}
            >
              <RefreshCw className={syncing ? "animate-spin" : ""} size={16} />
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          </div>
        }
      >
        {tailscale.loading ? <LoadingRows /> : null}
        {tailscale.error ? <p className="error-callout">{tailscale.error}</p> : null}
        <div className="space-y-4">
          {tailscale.data?.map((device) => (
            <div key={device.id} className="raised-card grid gap-4 xl:grid-cols-[1.1fr_1fr_0.8fr] xl:items-center">
              <div className="min-w-0">
                <p className="font-semibold text-white">{device.display_name}</p>
                <p className="mt-1 text-sm text-muted">{device.hostname ?? "No hostname"} / {device.os ?? "Unknown OS"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={device.online ? "online" : "offline"} />
                <StatusPill status={device.sync_status} />
                <span className="text-sm text-muted">Last seen: {device.last_seen ?? "Unknown"}</span>
              </div>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <button className="btn-secondary" onClick={() => openTailscaleSettings(device)}>
                  <Settings2 size={16} />
                  Settings
                </button>
                <button className="btn-primary" disabled={!canWake(device)} onClick={() => void wakeTailscale(device)}>
                  <Power size={16} />
                  Wake
                </button>
              </div>
            </div>
          ))}
          {tailscale.data?.length === 0 ? <p className="empty-state">No Tailscale devices synced yet. Add the API token in Settings and run sync.</p> : null}
        </div>
        {editingTailscaleDevice ? (
          <form className="mt-5 grid gap-5 rounded-2xl border border-accent/25 bg-deep/74 p-5" onSubmit={saveTailscaleSettings}>
            <div className="grid gap-2">
              <label className="field-label" htmlFor="tailscale-display-name">
                Display name
              </label>
              <input
                id="tailscale-display-name"
                className="input-field"
                placeholder={editingTailscaleDevice.machine_name}
                value={settingsForm.display_name ?? ""}
                onChange={(event) => setSettingsForm({ ...settingsForm, display_name: event.target.value })}
              />
              <p className="text-sm text-muted">Leave blank to use the Tailscale machine name.</p>
            </div>

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-mist">Tailscale information</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ["Tailscale name", editingTailscaleDevice.machine_name],
                  ["Hostname", editingTailscaleDevice.hostname],
                  ["Node ID", editingTailscaleDevice.node_id],
                  ["Tailscale ID", editingTailscaleDevice.tailscale_id],
                  ["OS", editingTailscaleDevice.os],
                  ["IP addresses", editingTailscaleDevice.tailscale_ips],
                  ["Tags", editingTailscaleDevice.tags],
                  ["Online", editingTailscaleDevice.online ? "Yes" : "No"],
                  ["Sync status", editingTailscaleDevice.sync_status],
                  ["Last seen", editingTailscaleDevice.last_seen],
                  ["Last synced", editingTailscaleDevice.last_synced_at]
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl border border-line bg-card/70 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{label}</p>
                    <p className="mt-1 break-all text-sm text-white">{detailValue(value as string | string[] | null)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-mist">Wake-on-LAN</h3>
              <label className="check-row">
                <input className="check-input" type="checkbox" checked={settingsForm.supports_wol} onChange={(event) => setSettingsForm({ ...settingsForm, supports_wol: event.target.checked })} />
                Supports Wake-on-LAN
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <input className="input-field" placeholder="MAC address" value={settingsForm.mac_address ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, mac_address: event.target.value })} />
                <input className="input-field" placeholder="LAN IP address" value={settingsForm.lan_ip_address ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, lan_ip_address: event.target.value })} />
                <input className="input-field" placeholder="Broadcast address" value={settingsForm.broadcast_address ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, broadcast_address: event.target.value })} />
              </div>
              <textarea className="textarea-field" placeholder="Note" value={settingsForm.note ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, note: event.target.value })} />
            </section>

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary">Save settings</button>
              <button className="btn-secondary" type="button" onClick={closeTailscaleSettings}>
                <X size={16} />
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {message ? <p className="info-callout mt-4">{message}</p> : null}
      </Panel>

      <Panel title="Manual devices" description="LAN devices you add and maintain directly in PiHomeHub.">
        {manual.loading ? <LoadingRows /> : null}
        {manual.error ? <p className="error-callout">{manual.error}</p> : null}
        <form className="mb-5 grid gap-3 rounded-2xl border border-line bg-deep/70 p-5" onSubmit={saveManual}>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="input-field" placeholder="Name" value={manualForm.name} onChange={(event) => setManualForm({ ...manualForm, name: event.target.value })} required />
            <input className="input-field" placeholder="Device type" value={manualForm.device_type} onChange={(event) => setManualForm({ ...manualForm, device_type: event.target.value })} />
            <input className="input-field" placeholder="Local IP" value={manualForm.ip_address ?? ""} onChange={(event) => setManualForm({ ...manualForm, ip_address: event.target.value })} />
            <input className="input-field" placeholder="Tailscale name" value={manualForm.tailscale_name ?? ""} onChange={(event) => setManualForm({ ...manualForm, tailscale_name: event.target.value })} />
            <input className="input-field" placeholder="MAC address" value={manualForm.mac_address ?? ""} onChange={(event) => setManualForm({ ...manualForm, mac_address: event.target.value })} />
            <label className="check-row">
              <input className="check-input" type="checkbox" checked={manualForm.supports_wol} onChange={(event) => setManualForm({ ...manualForm, supports_wol: event.target.checked })} />
              Supports WOL
            </label>
          </div>
          <textarea className="textarea-field" placeholder="Description" value={manualForm.description ?? ""} onChange={(event) => setManualForm({ ...manualForm, description: event.target.value })} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary">{editingManualId ? "Save device" : "Add device"}</button>
            {editingManualId ? (
              <button className="btn-secondary" type="button" onClick={() => { setEditingManualId(null); setManualForm(emptyManualDevice); }}>
                <X size={16} />
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <div className="space-y-4">
          {manual.data?.map((device) => (
            <div key={`${device.name}-${device.id ?? "local"}`} className="raised-card grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:items-center">
              <div className="min-w-0">
                <p className="font-semibold text-white">{device.name}</p>
                <p className="mt-1 text-sm text-muted">{device.device_type}</p>
              </div>
              <div className="text-sm text-muted">
                <p>{device.ip_address ?? "No IP configured"}</p>
                <p>{device.tailscale_name ?? "No Tailscale host"}</p>
              </div>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <StatusPill status={device.status} />
                {device.id ? (
                  <>
                    <button className="btn-secondary" onClick={() => editManual(device)}>
                      <Edit3 size={16} />
                      Edit
                    </button>
                    <button className="btn-danger" onClick={() => void deleteManual(device.id!)}>
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {manual.data?.length === 0 ? <p className="empty-state">No manual devices yet. Add one above when you want local Wake-on-LAN or a fixed LAN entry.</p> : null}
        </div>
      </Panel>
    </div>
  );
}
