import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Edit3, LockKeyhole, Power, RefreshCw, Settings2, Trash2, X } from "lucide-react";

import { api } from "../api/client";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Field, TextareaField } from "../components/Field";
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
  const [message, setMessage] = useState<Feedback | null>(null);
  const [manualMessage, setManualMessage] = useState<Feedback | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(lastTailscaleSyncLabel);
  const [tailscaleScrollRequest, setTailscaleScrollRequest] = useState(0);
  const tailscaleSettingsRef = useRef<HTMLFormElement>(null);
  const manualSettingsRef = useRef<HTMLFormElement>(null);
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
        setMessage({ kind: "success", text: `Tailscale sync completed for ${synced.length} devices at ${timestamp}.` });
      }
    } catch (error) {
      if (!silent) {
        setMessage(errorFeedback(error, "Tailscale device sync failed."));
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

  useEffect(() => {
    if (!editingTailscaleDevice || tailscaleScrollRequest === 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const settingsPanel = tailscaleSettingsRef.current;
      if (!settingsPanel) {
        return;
      }
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      settingsPanel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      settingsPanel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingTailscaleDevice, tailscaleScrollRequest]);

  const saveManual = async (event: FormEvent) => {
    event.preventDefault();
    const payload = cleanDevice(manualForm);
    setManualMessage(null);
    try {
      if (editingManualId) {
        const updated = await api.patch<DeviceSummary>(`/api/devices/${editingManualId}`, payload);
        manual.setData((current) => (current ?? []).map((device) => (device.id === editingManualId ? updated : device)));
        setManualMessage({ kind: "success", text: `${updated.name} device settings saved.` });
      } else {
        const created = await api.post<DeviceSummary>("/api/devices", payload);
        manual.setData((current) => [...(current ?? []), created]);
        setManualMessage({ kind: "success", text: `${created.name} added to manual devices.` });
      }
      setManualForm(emptyManualDevice);
      setEditingManualId(null);
    } catch (error) {
      setManualMessage(errorFeedback(error, "Manual device settings could not be saved."));
    }
  };

  const editManual = (device: DeviceSummary) => {
    if (!device.id) {
      return;
    }
    setManualMessage(null);
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
    window.requestAnimationFrame(() => {
      const settingsPanel = manualSettingsRef.current;
      if (!settingsPanel) {
        return;
      }
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      settingsPanel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      settingsPanel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
  };

  const deleteManual = async (device: DeviceSummary) => {
    if (!device.id) {
      return;
    }
    setManualMessage(null);
    try {
      await api.delete(`/api/devices/${device.id}`);
      manual.setData((current) => (current ?? []).filter((item) => item.id !== device.id));
      setManualMessage({ kind: "success", text: `${device.name} deleted from manual devices.` });
    } catch (error) {
      setManualMessage(errorFeedback(error, `${device.name} could not be deleted.`));
    }
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
    setTailscaleScrollRequest((request) => request + 1);
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
    setMessage(null);
    try {
      const updated = await api.patch<TailscaleDevice>(`/api/tailscale/devices/${editingTailscaleId}/settings`, {
        display_name: settingsForm.display_name || null,
        supports_wol: settingsForm.supports_wol,
        mac_address: settingsForm.mac_address || null,
        lan_ip_address: settingsForm.lan_ip_address || null,
        broadcast_address: settingsForm.broadcast_address || null,
        note: settingsForm.note || null
      });
      tailscale.setData((current) => (current ?? []).map((device) => (device.id === editingTailscaleId ? updated : device)));
      setMessage({ kind: "success", text: `${updated.display_name} device settings saved.` });
      closeTailscaleSettings();
    } catch (error) {
      setMessage(errorFeedback(error, `${editingTailscaleDevice?.display_name ?? "Tailscale device"} settings could not be saved.`));
    }
  };

  const wakeTailscale = async (device: TailscaleDevice) => {
    try {
      await api.post(`/api/tailscale/devices/${device.id}/wake`);
      setMessage({ kind: "success", text: `Wake packet sent to ${device.display_name}.` });
    } catch (error) {
      setMessage(errorFeedback(error, `Wake request for ${device.display_name} failed.`));
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
        <FeedbackMessage
          feedback={tailscale.error ? { kind: "error", persistent: true, text: tailscale.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void tailscale.refetch()}>Retry Tailscale devices</button>}
        />
        <div className="space-y-4">
          {tailscale.data?.map((device) => (
            <div key={device.id} className="raised-card grid gap-4 xl:grid-cols-[1.1fr_1fr_0.8fr] xl:items-center">
              <div className="min-w-0">
                <p className="font-semibold text-mist">{device.display_name}</p>
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
          <form
            ref={tailscaleSettingsRef}
            className="mt-5 grid scroll-mt-6 gap-5 rounded-[18px] border border-accent/25 bg-deep p-5"
            onSubmit={saveTailscaleSettings}
          >
            <Field
              id="tailscale-display-name"
              label="Display name"
              help={`Leave blank to use ${editingTailscaleDevice.machine_name}.`}
              value={settingsForm.display_name ?? ""}
              onChange={(event) => setSettingsForm({ ...settingsForm, display_name: event.target.value })}
            />

            <section className="grid gap-3 rounded-[18px] border border-line/70 bg-card/30 p-4" aria-label="Read-only Tailscale information">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-muted">Tailscale information</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-deep/60 px-2.5 py-1 text-xs font-semibold text-muted">
                  <LockKeyhole size={13} />
                  Read only
                </span>
              </div>
              <p className="text-xs leading-5 text-muted">These values come from Tailscale and cannot be changed in PiHomeHub.</p>
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
                  <div key={label as string} className="rounded-[14px] border border-line/70 bg-deep/40 px-4 py-3">
                    <p className="text-xs font-semibold text-muted">{label}</p>
                    <p className="mt-1 break-all text-sm text-muted">{detailValue(value as string | string[] | null)}</p>
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
                <Field label="MAC address" value={settingsForm.mac_address ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, mac_address: event.target.value })} />
                <Field label="LAN IP address" value={settingsForm.lan_ip_address ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, lan_ip_address: event.target.value })} />
                <Field label="Broadcast address" value={settingsForm.broadcast_address ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, broadcast_address: event.target.value })} />
              </div>
              <TextareaField label="Note" value={settingsForm.note ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, note: event.target.value })} />
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
        <FeedbackMessage feedback={message} className="mt-4" onDismiss={() => setMessage(null)} />
      </Panel>

      <Panel title="Manual devices" description="LAN devices you add and maintain directly in PiHomeHub.">
        {manual.loading ? <LoadingRows /> : null}
        <FeedbackMessage
          feedback={manual.error ? { kind: "error", persistent: true, text: manual.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void manual.refetch()}>Retry manual devices</button>}
        />
        <form ref={manualSettingsRef} className="mb-5 grid scroll-mt-6 gap-4 rounded-[18px] border border-line bg-deep p-5" onSubmit={saveManual}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name" value={manualForm.name} onChange={(event) => setManualForm({ ...manualForm, name: event.target.value })} required />
            <Field label="Device type" value={manualForm.device_type} onChange={(event) => setManualForm({ ...manualForm, device_type: event.target.value })} />
            <Field label="Local IP" value={manualForm.ip_address ?? ""} onChange={(event) => setManualForm({ ...manualForm, ip_address: event.target.value })} />
            <Field label="Tailscale name" value={manualForm.tailscale_name ?? ""} onChange={(event) => setManualForm({ ...manualForm, tailscale_name: event.target.value })} />
            <Field label="MAC address" value={manualForm.mac_address ?? ""} onChange={(event) => setManualForm({ ...manualForm, mac_address: event.target.value })} />
            <label className="check-row">
              <input className="check-input" type="checkbox" checked={manualForm.supports_wol} onChange={(event) => setManualForm({ ...manualForm, supports_wol: event.target.checked })} />
              Supports WOL
            </label>
          </div>
          <TextareaField label="Description" value={manualForm.description ?? ""} onChange={(event) => setManualForm({ ...manualForm, description: event.target.value })} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary">{editingManualId ? "Save device" : "Add device"}</button>
            {editingManualId ? (
              <button className="btn-secondary" type="button" onClick={() => { setEditingManualId(null); setManualForm(emptyManualDevice); setManualMessage(null); }}>
                <X size={16} />
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <FeedbackMessage feedback={manualMessage} className="mb-4" onDismiss={() => setManualMessage(null)} />
        <div className="space-y-4">
          {manual.data?.map((device) => (
            <div key={`${device.name}-${device.id ?? "local"}`} className="raised-card grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:items-center">
              <div className="min-w-0">
                <p className="font-semibold text-mist">{device.name}</p>
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
                    <button className="btn-danger" onClick={() => void deleteManual(device)}>
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
