import { useMemo, useState } from "react";
import { ArrowRight, Clock3, Cpu, ExternalLink, HardDrive, MemoryStick, Monitor, Power, Server, Sparkles, Thermometer, Wifi } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { DeviceSummary, PiStatus, ServiceLink, ServiceStatus, TailscaleDevice, TaskItem } from "../types/api";
import { resolveServiceLinkUrl } from "../utils/serviceLinks";

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function Metric({ label, value, percent, icon: Icon, tone = "cyan" }: { label: string; value: string; percent: number | null; icon: typeof Cpu; tone?: "cyan" | "mint" | "amber" | "violet" }) {
  const safePercent = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <article className={`metric-tile metric-tile--${tone}`}>
      <div className="metric-tile__top"><span className="metric-tile__icon"><Icon size={17} /></span><span className="metric-tile__label">{label}</span></div>
      <div className="metric-tile__value">{value}</div>
      <div className="metric-tile__track" aria-hidden="true"><span style={{ width: `${safePercent}%` }} /></div>
    </article>
  );
}

function DashboardSkeleton() {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-32" />)}</div>;
}

export function DashboardPage() {
  const metrics = useFetch<PiStatus>("/api/system/pi", { staleTimeMs: 4_000, refetchIntervalMs: 5_000 });
  const devices = useFetch<DeviceSummary[]>("/api/devices");
  const tailscaleDevices = useFetch<TailscaleDevice[]>("/api/tailscale/devices");
  const services = useFetch<ServiceStatus[]>("/api/services/status");
  const links = useFetch<ServiceLink[]>("/api/services/links");
  const tasks = useFetch<TaskItem[]>("/api/tasks");
  const [wolMessage, setWolMessage] = useState<Feedback | null>(null);

  const activeManual = devices.data?.filter((device) => device.status === "online") ?? [];
  const activeTailscale = tailscaleDevices.data?.filter((device) => device.sync_status === "active" && device.online) ?? [];
  const activeDevices = activeManual.length + activeTailscale.length;
  const totalDevices = (devices.data?.length ?? 0) + (tailscaleDevices.data?.length ?? 0);
  const healthyServices = services.data?.filter((service) => ["running", "online", "active"].includes(service.status.toLowerCase())).length ?? 0;
  const openTasks = tasks.data?.filter((task) => !task.is_complete) ?? [];
  const allOperational = Boolean(services.data?.length) && healthyServices === services.data?.length;
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const wake = async (deviceId: number, name: string) => {
    setWolMessage({ kind: "progress", text: `Sending wake packet to ${name}…` });
    try {
      await api.post("/api/wol/wake", { device_id: deviceId });
      setWolMessage({ kind: "success", text: `Wake packet sent to ${name}.` });
    } catch (error) {
      setWolMessage(errorFeedback(error, `Wake request for ${name} failed.`));
    }
  };

  const wakeTailscale = async (device: TailscaleDevice) => {
    setWolMessage({ kind: "progress", text: `Sending wake packet to ${device.display_name}…` });
    try {
      await api.post(`/api/tailscale/devices/${device.id}/wake`);
      setWolMessage({ kind: "success", text: `Wake packet sent to ${device.display_name}.` });
    } catch (error) {
      setWolMessage(errorFeedback(error, `Wake request for ${device.display_name} failed.`));
    }
  };

  return (
    <div className="page-stack">
      <section className="command-hero">
        <div className="command-hero__image" aria-hidden="true" />
        <div className="command-hero__shade" />
        <div className="command-hero__content">
          <div className="hero-status"><span className={allOperational ? "bg-success" : "bg-warning"} /> {allOperational ? "All systems operational" : "Hub needs attention"}</div>
          <p className="eyebrow eyebrow--light"><span /> Live home command</p>
          <h1>{greeting}.<br /><em>Your home is online.</em></h1>
          <p>One calm place to monitor your Pi, wake your desktop, run private services, and keep home maintenance moving.</p>
          <div className="hero-actions">
            <Link to="/devices" className="btn-hero"><Power size={17} /> Manage devices</Link>
            <Link to="/services" className="btn-hero-secondary">View services <ArrowRight size={16} /></Link>
          </div>
        </div>
        <div className="hero-facts" aria-label="Home overview">
          <div><Wifi size={17} /><span><strong>{activeDevices}</strong> online</span></div>
          <div><Server size={17} /><span><strong>{healthyServices}</strong> services healthy</span></div>
          <div><Clock3 size={17} /><span><strong>{metrics.data ? formatUptime(metrics.data.uptime_seconds) : "—"}</strong> uptime</span></div>
        </div>
      </section>

      {metrics.loading ? <DashboardSkeleton /> : metrics.error || !metrics.data ? (
        <FeedbackMessage
          feedback={{ kind: "error", persistent: true, text: metrics.error ?? "System metrics are unavailable." }}
          action={<button className="btn-secondary" onClick={() => void metrics.refetch()}>Retry system metrics</button>}
        />
      ) : (
        <section aria-labelledby="live-health-title">
          <div className="section-heading"><div><p className="eyebrow"><span /> Raspberry Pi</p><h2 id="live-health-title">Live system health</h2></div><span className="refresh-label">{metrics.refreshing ? <span className="refresh-dot" /> : null}{metrics.refreshing ? "Refreshing" : `Updated ${new Date(metrics.updatedAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="CPU load" value={`${metrics.data.cpu_percent.toFixed(0)}%`} percent={metrics.data.cpu_percent} icon={Cpu} tone="cyan" />
            <Metric label="Memory" value={`${metrics.data.memory_percent.toFixed(0)}%`} percent={metrics.data.memory_percent} icon={MemoryStick} tone="violet" />
            <Metric label="Storage" value={`${metrics.data.disk_percent.toFixed(0)}%`} percent={metrics.data.disk_percent} icon={HardDrive} tone="mint" />
            <Metric label="Temperature" value={metrics.data.temperature_c ? `${metrics.data.temperature_c.toFixed(1)}°C` : "N/A"} percent={metrics.data.temperature_c ? (metrics.data.temperature_c / 85) * 100 : null} icon={Thermometer} tone="amber" />
          </div>
        </section>
      )}

      <div className="dashboard-grid">
        <Panel title="Active devices" description={`${activeDevices} of ${totalDevices} devices are reachable now.`} action={<Link className="panel-link" to="/devices">All devices <ArrowRight size={15} /></Link>}>
          <div className="device-orbit-list">
            {devices.loading || tailscaleDevices.loading ? <><div className="skeleton h-20" /><div className="skeleton h-20" /></> : null}
            <FeedbackMessage
              feedback={devices.error || tailscaleDevices.error ? { kind: "error", persistent: true, text: devices.error ?? tailscaleDevices.error ?? "Device status is unavailable." } : null}
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void Promise.all([devices.refetch(), tailscaleDevices.refetch()])}>Retry device status</button>}
            />
            {activeManual.slice(0, 3).map((device) => (
              <div className="device-row" key={`manual-${device.id ?? device.name}`}>
                <div className="device-avatar"><Monitor size={20} /></div><div className="min-w-0 flex-1"><p>{device.name}</p><span>{device.description ?? device.device_type}</span></div><StatusPill status="online" />
                {device.supports_wol && device.id ? <button className="round-action" aria-label={`Wake ${device.name}`} onClick={() => void wake(device.id!, device.name)}><Power size={16} /></button> : null}
              </div>
            ))}
            {activeTailscale.slice(0, Math.max(0, 3 - activeManual.length)).map((device) => (
              <div className="device-row" key={`tailscale-${device.id}`}>
                <div className="device-avatar device-avatar--cyan"><Monitor size={20} /></div><div className="min-w-0 flex-1"><p>{device.display_name}</p><span>{device.os ?? "Tailscale device"}</span></div><StatusPill status="online" />
                {device.supports_wol && device.mac_address ? <button className="round-action" aria-label={`Wake ${device.display_name}`} onClick={() => void wakeTailscale(device)}><Power size={16} /></button> : null}
              </div>
            ))}
            {!devices.loading && !tailscaleDevices.loading && activeDevices === 0 ? <p className="empty-state">No device is online right now. Check Tailscale sync or your LAN connection.</p> : null}
            <FeedbackMessage feedback={wolMessage} onDismiss={() => setWolMessage(null)} />
          </div>
        </Panel>

        <Panel title="Service constellation" description="Private tools running around your hub." action={<Link className="panel-link" to="/services">Manage <ArrowRight size={15} /></Link>}>
          <div className="service-constellation">
            {services.loading ? <div className="skeleton h-56" /> : null}
            <FeedbackMessage
              feedback={services.error ? { kind: "error", persistent: true, text: services.error } : null}
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void services.refetch()}>Retry service status</button>}
            />
            {services.data?.slice(0, 6).map((service, index) => (
              <div className="service-node" key={service.slug} style={{ "--node-index": index } as React.CSSProperties}>
                <span className="service-node__icon"><Server size={18} /></span><div><p>{service.name}</p><StatusPill status={service.status} /></div>
              </div>
            ))}
            {services.data?.length === 0 ? <p className="empty-state">No services are reporting status yet.</p> : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
        <Panel title="Next up" description="Your open home maintenance tasks." action={<Link className="panel-link" to="/planner">Planner <ArrowRight size={15} /></Link>}>
          <div className="timeline-list">
            {tasks.loading ? <div className="skeleton h-32" /> : null}
            <FeedbackMessage
              feedback={tasks.error ? { kind: "error", persistent: true, text: tasks.error } : null}
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void tasks.refetch()}>Retry tasks</button>}
            />
            {openTasks.slice(0, 4).map((task, index) => <div className="timeline-item" key={task.id}><span>{index + 1}</span><div><p>{task.title}</p><small>{task.due_label ?? "Anytime"}</small></div></div>)}
            {!tasks.loading && openTasks.length === 0 ? <p className="empty-state">Nothing pending. Your home queue is clear.</p> : null}
          </div>
        </Panel>

        <Panel title="Launchpad" description="Jump directly into the tools your home runs." action={<Sparkles className="text-accent" size={18} />}>
          <div className="launchpad-grid">
            {links.loading ? <div className="skeleton col-span-full h-32" /> : null}
            <FeedbackMessage
              feedback={links.error ? { kind: "error", persistent: true, text: links.error } : null}
              className="col-span-full"
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void links.refetch()}>Retry dashboard links</button>}
            />
            {links.data?.map((link, index) => {
              const resolvedUrl = resolveServiceLinkUrl(link.url);
              return <a key={link.slug} href={resolvedUrl} target="_blank" rel="noreferrer" className="launch-card"><span className={`launch-card__icon launch-card__icon--${index % 4}`}><Server size={20} /></span><div><p>{link.name}</p><small>{link.description ?? "Open dashboard"}</small></div><ExternalLink size={15} /></a>;
            })}
            {links.data?.length === 0 ? <p className="empty-state col-span-full">No quick links configured yet.</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
