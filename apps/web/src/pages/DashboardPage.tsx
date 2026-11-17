import { useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, Cpu, ExternalLink, HardDrive, MemoryStick, Monitor, Power, Server, Thermometer } from "lucide-react";
import { Link } from "react-router-dom";

import { SnoopyAsciiArtwork } from "../components/SnoopyAsciiArtwork";
import { AsciiWordmark } from "../components/AsciiWordmark";
import { api } from "../api/client";
import { usePermissions } from "../components/AdminOnly";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { DeviceSummary, PiStatus, ServiceLink, ServiceStatus, TailscaleDevice, TaskItem } from "../types/api";
import { dashboardLinks, serviceLinkHref } from "../utils/serviceLinks";

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function Metric({ label, value, percent, icon: Icon }: { label: string; value: string; percent: number | null; icon: typeof Cpu }) {
  const filledSegments = Math.round(Math.max(0, Math.min(100, percent ?? 0)) / 5);
  return (
    <article className="metric-tile">
      <div className="metric-tile__top"><span className="metric-tile__icon"><Icon size={17} /></span><span className="metric-tile__label">{label}</span></div>
      <div className="metric-tile__value"><span key={value} className="metric-reading">{value}</span></div>
      <div className="metric-tile__track" aria-hidden="true" data-available={percent != null}>
        {Array.from({ length: 20 }, (_, index) => <span key={index} data-lit={percent != null && index < filledSegments} />)}
      </div>
    </article>
  );
}

function DashboardSkeleton() {
  return <div className="metrics-strip">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-32" />)}</div>;
}

export function DashboardPage() {
  const { isAdmin } = usePermissions();
  const metrics = useFetch<PiStatus>("/api/system/pi", { staleTimeMs: 4_000, refetchIntervalMs: 5_000 });
  const devices = useFetch<DeviceSummary[]>("/api/devices");
  const tailscaleDevices = useFetch<TailscaleDevice[]>("/api/tailscale/devices");
  const services = useFetch<ServiceStatus[]>("/api/services/status", { refetchIntervalMs: 15_000 });
  const links = useFetch<ServiceLink[]>("/api/services/links");
  const tasks = useFetch<TaskItem[]>("/api/tasks");
  const [wolMessage, setWolMessage] = useState<Feedback | null>(null);
  const [waking, setWaking] = useState(false);
  const wakeLock = useRef(false);

  const quickLinks = useMemo(() => dashboardLinks(links.data, services.data), [links.data, services.data]);
  const activeManual = devices.data?.filter((device) => device.status === "online") ?? [];
  const activeTailscale = tailscaleDevices.data?.filter((device) => device.sync_status === "active" && device.online) ?? [];
  const activeDevices = activeManual.length + activeTailscale.length;
  const totalDevices = (devices.data?.length ?? 0) + (tailscaleDevices.data?.length ?? 0);
  const runningServices = services.data?.filter((service) => ["running", "online", "active"].includes(service.status.toLowerCase())).length ?? 0;
  const unhealthyServices = services.data?.filter((service) => service.health_status === "unhealthy").length ?? 0;
  const openTasks = tasks.data?.filter((task) => !task.is_complete) ?? [];
  const servicesKnown = services.data != null && !services.error && !services.loading;
  const devicesKnown = devices.data != null && tailscaleDevices.data != null && !devices.error && !tailscaleDevices.error;
  const statusText = !servicesKnown ? "Service status unavailable" : unhealthyServices > 0 ? `${unhealthyServices} service${unhealthyServices === 1 ? " needs" : "s need"} attention` : `${runningServices} of ${services.data!.length} services running`;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const wake = async (deviceId: number, name: string) => {
    if (!isAdmin || wakeLock.current) return;
    wakeLock.current = true; setWaking(true);
    setWolMessage({ kind: "progress", text: `Sending wake packet to ${name}…` });
    try {
      await api.post("/api/wol/wake", { device_id: deviceId });
      setWolMessage({ kind: "success", text: `Wake packet sent to ${name}.` });
    } catch (error) {
      setWolMessage(errorFeedback(error, `Wake request for ${name} failed.`));
    } finally {
      wakeLock.current = false; setWaking(false);
    }
  };

  const wakeTailscale = async (device: TailscaleDevice) => {
    if (!isAdmin || wakeLock.current) return;
    wakeLock.current = true; setWaking(true);
    setWolMessage({ kind: "progress", text: `Sending wake packet to ${device.display_name}…` });
    try {
      await api.post(`/api/tailscale/devices/${device.id}/wake`);
      setWolMessage({ kind: "success", text: `Wake packet sent to ${device.display_name}.` });
    } catch (error) {
      setWolMessage(errorFeedback(error, `Wake request for ${device.display_name} failed.`));
    } finally {
      wakeLock.current = false; setWaking(false);
    }
  };

  return (
    <div className="page-stack overview-page">
      <header className="overview-header overview-header--ascii">
        <div className="overview-header__intro">
          <AsciiWordmark />
          <h1 className="page-title">Home overview<span className="title-period">.</span></h1>
          <p className="page-copy">{today}<span className="copy-separator">/</span>Everything in its place.</p>
          <Link to="/devices" className="btn-secondary"><Monitor size={16} /> Manage devices <ArrowRight size={15} /></Link>
        </div>
        <SnoopyAsciiArtwork />
      </header>
      <div className="overview-status">
        <Link to="/services" className="overview-status__main"><span className={`status-signal ${!servicesKnown ? "status-signal--unknown" : unhealthyServices > 0 ? "status-signal--warning" : runningServices > 0 ? "status-signal--online" : "status-signal--unknown"}`} />{statusText}<ArrowRight size={14} /></Link>
        <span><Monitor size={14} />{devicesKnown ? `${activeDevices} of ${totalDevices} devices online` : "Device status unavailable"}</span>
        <span><Clock3 size={14} />{metrics.data && !metrics.error ? `${formatUptime(metrics.data.uptime_seconds)} uptime` : "Uptime unavailable"}</span>
      </div>

      {metrics.loading ? <DashboardSkeleton /> : metrics.error || !metrics.data ? (
        <FeedbackMessage
          feedback={{ kind: "error", persistent: true, text: metrics.error ?? "System metrics are unavailable." }}
          action={<button className="btn-secondary" onClick={() => void metrics.refetch()}>Retry system metrics</button>}
        />
      ) : (
        <section aria-labelledby="live-health-title">
          <div className="section-heading"><div className="server-heading"><span className="server-glyph" aria-hidden="true"><i /><i /><i /><i /></span><h2 id="live-health-title">The server</h2>{metrics.data.hostname ? <span className="host-label">{metrics.data.hostname}</span> : null}</div><span className="refresh-label"><span key={metrics.updatedAt} className="sample-mark" aria-hidden="true" />{metrics.refreshing ? "Refreshing" : `Updated ${new Date(metrics.updatedAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span></div>
          <div className="metrics-strip metrics-strip--ready">
            <Metric label="CPU load" value={`${metrics.data.cpu_percent.toFixed(0)}%`} percent={metrics.data.cpu_percent} icon={Cpu} />
            <Metric label="Memory" value={metrics.data.memory_percent == null ? "N/A" : `${metrics.data.memory_percent.toFixed(0)}%`} percent={metrics.data.memory_percent} icon={MemoryStick} />
            <Metric label="Storage" value={metrics.data.disk_percent == null ? "N/A" : `${metrics.data.disk_percent.toFixed(0)}%`} percent={metrics.data.disk_percent} icon={HardDrive} />
            <Metric label="Temperature" value={metrics.data.temperature_c != null ? `${metrics.data.temperature_c.toFixed(1)}°C` : "N/A"} percent={metrics.data.temperature_c != null ? (metrics.data.temperature_c / 85) * 100 : null} icon={Thermometer} />
          </div>
        </section>
      )}

      <div className="overview-workbench">
        <Panel title="Services" description="Container state, at a glance." action={<Link className="panel-link" to="/services">Manage <ArrowRight size={15} /></Link>}>
          <div className="service-constellation">
            {services.loading ? <div className="skeleton h-56" /> : null}
            <FeedbackMessage
              feedback={services.error ? { kind: "error", persistent: true, text: services.error } : null}
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void services.refetch()}>Retry service status</button>}
            />
            {services.data?.slice(0, 6).map((service) => (
              <div className="service-node" key={service.slug}>
                <span className="service-node__icon"><Server size={17} /></span><div><p>{service.name}</p><small>{service.health_status ? `Health: ${service.health_status}` : service.status === "missing" ? "Not installed" : "No health check"}</small></div><StatusPill status={service.status} />
              </div>
            ))}
            {services.data?.length === 0 ? <p className="empty-state">No services are reporting status yet.</p> : null}
          </div>
        </Panel>
        <div className="overview-household">
          <Panel title="Active devices" description={devicesKnown ? `${activeDevices} of ${totalDevices} devices are reachable now.` : "Checking device reachability."} action={<Link className="panel-link" to="/devices">All devices <ArrowRight size={15} /></Link>}>
          <div className="device-orbit-list">
            {devices.loading || tailscaleDevices.loading ? <><div className="skeleton h-20" /><div className="skeleton h-20" /></> : null}
            <FeedbackMessage
              feedback={devices.error || tailscaleDevices.error ? { kind: "error", persistent: true, text: devices.error ?? tailscaleDevices.error ?? "Device status is unavailable." } : null}
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void Promise.all([devices.refetch(), tailscaleDevices.refetch()])}>Retry device status</button>}
            />
            {activeManual.slice(0, 3).map((device) => (
              <div className="device-row" key={`manual-${device.id ?? device.name}`}>
                <div className="device-avatar"><Monitor size={20} /></div><div className="min-w-0 flex-1"><p>{device.name}</p><span>{device.description ?? device.device_type}</span></div><StatusPill status="online" />
                {device.supports_wol && device.mac_address && device.id ? <button className="round-action" disabled={!isAdmin || waking} aria-label={`Wake ${device.name}`} aria-describedby={!isAdmin ? "dashboard-wol-admin-required" : undefined} onClick={() => { if (isAdmin) void wake(device.id!, device.name); }}><Power size={16} /></button> : null}
              </div>
            ))}
            {activeTailscale.slice(0, Math.max(0, 3 - activeManual.length)).map((device) => (
              <div className="device-row" key={`tailscale-${device.id}`}>
                <div className="device-avatar device-avatar--cyan"><Monitor size={20} /></div><div className="min-w-0 flex-1"><p>{device.display_name}</p><span>{device.os ?? "Tailscale device"}</span></div><StatusPill status="online" />
                {device.supports_wol && device.mac_address ? <button className="round-action" disabled={!isAdmin || waking} aria-label={`Wake ${device.display_name}`} aria-describedby={!isAdmin ? "dashboard-wol-admin-required" : undefined} onClick={() => { if (isAdmin) void wakeTailscale(device); }}><Power size={16} /></button> : null}
              </div>
            ))}
            {!isAdmin && (activeManual.some((device) => device.supports_wol && device.mac_address && device.id) || activeTailscale.some((device) => device.supports_wol && device.mac_address)) ? <p id="dashboard-wol-admin-required" className="text-xs text-muted">Administrator access required to send Wake-on-LAN.</p> : null}
            {devicesKnown && activeDevices === 0 ? <p className="empty-state">No device is online right now. Check Tailscale sync or your LAN connection.</p> : null}
            <FeedbackMessage feedback={wolMessage} onDismiss={() => setWolMessage(null)} />
          </div>
        </Panel>
          <Panel title="Next up" description="Your open home maintenance tasks." action={<Link className="panel-link" to="/planner">Planner <ArrowRight size={15} /></Link>}>
          <div className="timeline-list">
            {tasks.loading ? <div className="skeleton h-32" /> : null}
            <FeedbackMessage
              feedback={tasks.error ? { kind: "error", persistent: true, text: tasks.error } : null}
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void tasks.refetch()}>Retry tasks</button>}
            />
            {openTasks.slice(0, 4).map((task) => <div className="timeline-item" key={task.id}><span><Check size={13} /></span><div><p>{task.title}</p><small>{task.due_label ?? "Anytime"}</small></div></div>)}
            {!tasks.loading && openTasks.length === 0 ? <p className="empty-state">Nothing pending. Your home queue is clear.</p> : null}
          </div>
        </Panel>
        </div>
      </div>
      <Panel title="Quick access" description="Your service dashboards and saved links." action={<Link className="panel-link" to="/services">Edit links <ArrowRight size={15} /></Link>}>
          <div className="launchpad-grid">
            {links.loading ? <div className="skeleton col-span-full h-32" /> : null}
            <FeedbackMessage
              feedback={links.error ? { kind: "error", persistent: true, text: links.error } : null}
              className="col-span-full"
              action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void links.refetch()}>Retry dashboard links</button>}
            />
            {quickLinks.map((link) => {
              const resolvedUrl = serviceLinkHref(link);
              return <a key={link.slug} href={resolvedUrl} target="_blank" rel="noreferrer" className="launch-card"><div><p>{link.name}</p><small>{link.description ?? "Open dashboard"}</small></div><ExternalLink size={15} /></a>;
            })}
            {quickLinks.length === 0 ? <p className="empty-state col-span-full">No running service dashboards or saved links are available.</p> : null}
          </div>
        </Panel>
    </div>
  );
}
