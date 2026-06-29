import { useState } from "react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import { Link } from "react-router-dom";
import type { DeviceSummary, PiStatus, ServiceLink, ServiceStatus, TailscaleDevice, TaskItem } from "../types/api";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-clay p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const metrics = useFetch<PiStatus>("/api/system/pi", { staleTimeMs: 4_000, refetchIntervalMs: 5_000 });
  const devices = useFetch<DeviceSummary[]>("/api/devices");
  const tailscaleDevices = useFetch<TailscaleDevice[]>("/api/tailscale/devices");
  const services = useFetch<ServiceStatus[]>("/api/services/status");
  const links = useFetch<ServiceLink[]>("/api/services/links");
  const tasks = useFetch<TaskItem[]>("/api/tasks");
  const [wolMessage, setWolMessage] = useState<string | null>(null);
  const activeManualDevices = devices.data?.filter((device) => device.status === "online") ?? [];
  const activeTailscaleDevices = tailscaleDevices.data?.filter((device) => device.sync_status === "active" && device.online) ?? [];
  const manualHiddenCount = devices.data ? devices.data.length - activeManualDevices.length : 0;
  const tailscaleHiddenCount = tailscaleDevices.data ? tailscaleDevices.data.length - activeTailscaleDevices.length : 0;
  const hiddenDeviceCount = manualHiddenCount + tailscaleHiddenCount;
  const devicesLoaded = devices.data !== null && tailscaleDevices.data !== null;
  const hasActiveDevices = activeManualDevices.length + activeTailscaleDevices.length > 0;

  const wake = async (deviceId: number) => {
    try {
      await api.post("/api/wol/wake", { device_id: deviceId });
      setWolMessage("Wake-on-LAN packet sent.");
    } catch (error) {
      setWolMessage(error instanceof Error ? error.message : "Wake failed");
    }
  };

  const wakeTailscale = async (device: TailscaleDevice) => {
    try {
      await api.post(`/api/tailscale/devices/${device.id}/wake`);
      setWolMessage(`Wake-on-LAN packet sent to ${device.display_name}.`);
    } catch (error) {
      setWolMessage(error instanceof Error ? error.message : "Wake failed");
    }
  };

  return (
    <div className="grid gap-6">
      <Panel
        title="System Overview"
        action={
          <span className="text-sm text-slate-500">
            {metrics.refreshing ? "Refreshing..." : metrics.updatedAt ? `Updated ${new Date(metrics.updatedAt).toLocaleTimeString()}` : null}
          </span>
        }
      >
        {metrics.loading ? (
          <p>Loading system metrics…</p>
        ) : metrics.error || !metrics.data ? (
          <p className="text-red-700">{metrics.error ?? "Metrics unavailable"}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="CPU" value={`${metrics.data.cpu_percent.toFixed(0)}%`} />
            <Metric label="RAM" value={`${metrics.data.memory_percent.toFixed(0)}%`} />
            <Metric label="Disk" value={`${metrics.data.disk_percent.toFixed(0)}%`} />
            <Metric label="Temp" value={metrics.data.temperature_c ? `${metrics.data.temperature_c.toFixed(1)} C` : "N/A"} />
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Devices">
          <div className="space-y-4">
            {activeManualDevices.map((device) => (
              <div key={`${device.name}-${device.id ?? "local"}`} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-100 bg-white p-4">
                <div>
                  <p className="font-semibold text-ink">{device.name}</p>
                  <p className="text-sm text-slate-500">{device.description ?? device.device_type}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={device.status} />
                  {device.supports_wol && device.id !== null ? (
                    <button
                      className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink"
                      onClick={() => {
                        if (device.id !== null) {
                          void wake(device.id);
                        }
                      }}
                    >
                      Wake
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {tailscaleDevices.error ? <p className="text-sm text-red-700">{tailscaleDevices.error}</p> : null}
            {activeTailscaleDevices.map((device) => (
              <div key={`tailscale-${device.id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-100 bg-white p-4">
                <div>
                  <p className="font-semibold text-ink">{device.display_name}</p>
                  <p className="text-sm text-slate-500">{device.hostname ?? device.machine_name} · {device.os ?? "Unknown OS"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={device.online ? "online" : "offline"} />
                  {device.supports_wol && device.mac_address ? (
                    <button
                      className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink"
                      onClick={() => {
                        void wakeTailscale(device);
                      }}
                    >
                      Wake
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {devicesLoaded && !hasActiveDevices ? <p className="text-sm text-slate-600">No active devices right now.</p> : null}
            {hiddenDeviceCount > 0 ? (
              <Link to="/devices" className="block text-sm font-semibold text-moss">
                {hiddenDeviceCount} inactive {hiddenDeviceCount === 1 ? "device" : "devices"} hidden
              </Link>
            ) : null}
            {wolMessage ? <p className="text-sm text-slate-600">{wolMessage}</p> : null}
          </div>
        </Panel>

        <Panel title="Planner">
          <div className="space-y-3">
            {tasks.data?.map((task) => (
              <div key={task.id} className="rounded-3xl bg-clay px-4 py-3">
                <p className={`font-semibold ${task.is_complete ? "line-through text-slate-500" : "text-ink"}`}>{task.title}</p>
                <p className="text-sm text-slate-500">{task.due_label ?? "No due label"}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Services">
          <div className="space-y-3">
            {services.data?.map((service) => (
              <div key={service.slug} className="flex items-center justify-between rounded-3xl border border-slate-100 bg-white p-4">
                <div>
                  <p className="font-semibold text-ink">{service.name}</p>
                  <p className="text-sm text-slate-500">{service.detail}</p>
                </div>
                <StatusPill status={service.status} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Quick Links">
          <div className="grid gap-3">
            {links.data?.map((link) => (
              <a key={link.slug} href={link.url} target="_blank" rel="noreferrer" className="rounded-3xl border border-slate-100 bg-white p-4 transition hover:-translate-y-0.5">
                <p className="font-semibold text-ink">{link.name}</p>
                <p className="text-sm text-slate-500">{link.description ?? link.url}</p>
              </a>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
