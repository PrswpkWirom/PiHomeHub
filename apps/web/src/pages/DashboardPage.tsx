import { useState } from "react";
import { ArrowRight, Cpu, ExternalLink, HardDrive, MemoryStick, Power, Thermometer } from "lucide-react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import { Link } from "react-router-dom";
import type { DeviceSummary, PiStatus, ServiceLink, ServiceStatus, TailscaleDevice, TaskItem } from "../types/api";
import { resolveServiceLinkUrl } from "../utils/serviceLinks";

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail?: string; icon: typeof Cpu }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <Icon className="text-accent" size={18} />
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tabular-nums text-mist">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
    </div>
  );
}

function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton h-28" />
      ))}
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
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="page-title">Home systems at a glance</h1>
          <p className="page-copy">Health, devices, and services stay visible first. Planner items and shortcuts sit behind the operational view.</p>
        </div>
      </div>

      <Panel
        title="System health"
        action={
          <span className="rounded-full border border-line bg-deep px-3 py-2 text-xs font-semibold text-muted">
            {metrics.refreshing ? "Refreshing..." : metrics.updatedAt ? `Updated ${new Date(metrics.updatedAt).toLocaleTimeString()}` : "Waiting"}
          </span>
        }
      >
        {metrics.loading ? (
          <SkeletonGrid />
        ) : metrics.error || !metrics.data ? (
          <p className="error-callout">{metrics.error ?? "Metrics unavailable."}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="CPU" value={`${metrics.data.cpu_percent.toFixed(0)}%`} detail={metrics.data.hostname} icon={Cpu} />
            <Metric label="Memory" value={`${metrics.data.memory_percent.toFixed(0)}%`} detail={metrics.data.platform} icon={MemoryStick} />
            <Metric label="Disk" value={`${metrics.data.disk_percent.toFixed(0)}%`} detail={metrics.data.local_ip ?? "No local IP"} icon={HardDrive} />
            <Metric label="Temp" value={metrics.data.temperature_c ? `${metrics.data.temperature_c.toFixed(1)} C` : "N/A"} detail="Pi thermal reading" icon={Thermometer} />
          </div>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Active devices" description="Online manual and Tailscale devices that are reachable now.">
          <div className="space-y-4">
            {devices.loading || tailscaleDevices.loading ? <div className="skeleton h-24" /> : null}
            {devices.error ? <p className="error-callout">{devices.error}</p> : null}
            {activeManualDevices.map((device) => (
              <div key={`${device.name}-${device.id ?? "local"}`} className="raised-card flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-mist">{device.name}</p>
                  <p className="mt-1 text-sm text-muted">{device.description ?? device.device_type}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={device.status} />
                  {device.supports_wol && device.id !== null ? (
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        if (device.id !== null) {
                          void wake(device.id);
                        }
                      }}
                    >
                      <Power size={16} />
                      Wake
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {tailscaleDevices.error ? <p className="error-callout">{tailscaleDevices.error}</p> : null}
            {activeTailscaleDevices.map((device) => (
              <div key={`tailscale-${device.id}`} className="raised-card flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-mist">{device.display_name}</p>
                  <p className="mt-1 text-sm text-muted">{device.hostname ?? device.machine_name} / {device.os ?? "Unknown OS"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={device.online ? "online" : "offline"} />
                  {device.supports_wol && device.mac_address ? (
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        void wakeTailscale(device);
                      }}
                    >
                      <Power size={16} />
                      Wake
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {devicesLoaded && !hasActiveDevices ? <p className="empty-state">No active devices right now. Devices will appear here when they report online.</p> : null}
            {hiddenDeviceCount > 0 ? (
              <Link to="/devices" className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-accent-focus">
                {hiddenDeviceCount} inactive {hiddenDeviceCount === 1 ? "device" : "devices"} hidden
                <ArrowRight size={16} />
              </Link>
            ) : null}
            {wolMessage ? <p className="info-callout">{wolMessage}</p> : null}
          </div>
        </Panel>

        <Panel title="Service status" description="Current health for the local services exposed by PiHomeHub.">
          <div className="space-y-3">
            {services.loading ? <div className="skeleton h-24" /> : null}
            {services.error ? <p className="error-callout">{services.error}</p> : null}
            {services.data?.map((service) => (
              <div key={service.slug} className="raised-card flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-mist">{service.name}</p>
                  <p className="mt-1 truncate text-sm text-muted">{service.detail}</p>
                </div>
                <StatusPill status={service.status} />
              </div>
            ))}
            {services.data?.length === 0 ? <p className="empty-state">No services are reporting status yet.</p> : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Planner" description="Open tasks kept secondary to the live operational panels.">
          <div className="space-y-3">
            {tasks.loading ? <div className="skeleton h-20" /> : null}
            {tasks.error ? <p className="error-callout">{tasks.error}</p> : null}
            {tasks.data?.slice(0, 4).map((task) => (
              <div key={task.id} className="raised-card">
                <p className={`font-semibold ${task.is_complete ? "text-muted line-through" : "text-mist"}`}>{task.title}</p>
                <p className="mt-1 text-sm text-muted">{task.due_label ?? "No due label"}</p>
              </div>
            ))}
            {tasks.data?.length === 0 ? <p className="empty-state">No tasks yet.</p> : null}
            {(tasks.data?.length ?? 0) > 4 ? (
              <Link to="/planner" className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-accent-focus">
                View all tasks
                <ArrowRight size={16} />
              </Link>
            ) : null}
          </div>
        </Panel>

        <Panel title="Quick links" description="Pinned dashboards and service entry points.">
          <div className="grid gap-3 sm:grid-cols-2">
            {links.loading ? <div className="skeleton h-28 sm:col-span-2" /> : null}
            {links.error ? <p className="error-callout sm:col-span-2">{links.error}</p> : null}
            {links.data?.map((link) => {
              const resolvedUrl = resolveServiceLinkUrl(link.url);
              return (
                <a key={link.slug} href={resolvedUrl} target="_blank" rel="noreferrer" className="raised-card group block transition duration-200 hover:-translate-y-0.5 hover:border-accent/35">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-mist">{link.name}</p>
                    <ExternalLink className="text-muted transition group-hover:text-accent" size={16} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{link.description ?? resolvedUrl}</p>
                </a>
              );
            })}
            {links.data?.length === 0 ? <p className="empty-state sm:col-span-2">No dashboard links configured.</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
