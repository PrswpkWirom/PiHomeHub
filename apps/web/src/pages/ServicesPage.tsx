import { AlertTriangle, ExternalLink, Info, RotateCcw, Save, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { ServiceActionResult, ServiceCapability, ServiceLink, ServicePortConfig, ServiceStatus } from "../types/api";
import { resolveServiceLinkUrl } from "../utils/serviceLinks";

type ServiceInfo = {
  summary: string;
  useCase: string;
  links: {
    label: string;
    url: string;
  }[];
};

type ActionMessage = {
  kind: "success" | "error";
  serviceSlug: string;
  text: string;
};

type PortMessage = {
  kind: "success" | "error";
  text: string;
};

const SERVICE_INFO: Record<string, ServiceInfo> = {
  "adguard-home": {
    summary: "Network-wide DNS filtering for blocking ads, trackers, and unwanted domains before they reach your devices.",
    useCase: "Use it when you want privacy-focused DNS controls for the whole home network from one dashboard.",
    links: [
      { label: "Official site", url: "https://adguard.com/en/adguard-home/overview.html" },
      { label: "Documentation", url: "https://adguard-dns.io/kb/adguard-home/" }
    ]
  },
  gitea: {
    summary: "A lightweight self-hosted Git service with repositories, pull requests, issues, packages, and web-based code browsing.",
    useCase: "Use it when you want private Git hosting on your own Pi instead of relying on a public code host.",
    links: [
      { label: "Official site", url: "https://about.gitea.com/" },
      { label: "Documentation", url: "https://docs.gitea.com/" }
    ]
  },
  "uptime-kuma": {
    summary: "A self-hosted uptime monitor that checks services, websites, ports, and containers, then shows status history.",
    useCase: "Use it when you want alerts and a clear status page for the services running in PiHomeHub.",
    links: [
      { label: "Project page", url: "https://github.com/louislam/uptime-kuma" },
      { label: "Documentation", url: "https://github.com/louislam/uptime-kuma/wiki" }
    ]
  },
  vaultwarden: {
    summary: "A lightweight Bitwarden-compatible password manager server for storing and syncing passwords privately.",
    useCase: "Use it when you want a personal password vault hosted on your own infrastructure.",
    links: [
      { label: "Project page", url: "https://github.com/dani-garcia/vaultwarden" },
      { label: "Documentation", url: "https://github.com/dani-garcia/vaultwarden/wiki" }
    ]
  },
  mosquitto: {
    summary: "An MQTT broker that lets smart-home devices and apps exchange small messages through publish/subscribe topics.",
    useCase: "Use it when you have Home Assistant, sensors, automations, or IoT devices that communicate over MQTT.",
    links: [
      { label: "Official site", url: "https://mosquitto.org/" },
      { label: "Documentation", url: "https://mosquitto.org/documentation/" }
    ]
  }
};

function actionsForStatus(service: ServiceStatus, capability: ServiceCapability | undefined) {
  if (!capability) {
    return [];
  }
  if (service.status === "missing") {
    return ["build", "start"].filter((action) => capability.actions.includes(action));
  }
  if (service.status === "running") {
    return ["stop", "restart"].filter((action) => capability.actions.includes(action));
  }
  return ["start", "restart"].filter((action) => capability.actions.includes(action));
}

function actionLabel(action: string) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function formatProtocols(protocols: string[]) {
  return protocols.map((protocol) => protocol.toUpperCase()).join("/");
}

function formatRunningPorts(port: ServicePortConfig["ports"][number]) {
  return port.protocols
    .map((protocol) => `${protocol.toUpperCase()} ${port.running_host_ports[protocol] ?? "not active"}`)
    .join(", ");
}

function parsePortDrafts(config: ServicePortConfig, drafts: Record<string, string> | undefined) {
  const nextPorts: Record<string, number> = {};
  for (const port of config.ports) {
    const raw = drafts?.[port.key] ?? String(port.desired_host_port);
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`${port.label} must be a whole number.`);
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${port.label} must be between 1 and 65535.`);
    }
    nextPorts[port.key] = value;
  }
  return nextPorts;
}

type PortEditorProps = {
  config: ServicePortConfig | undefined;
  drafts: Record<string, string> | undefined;
  message: PortMessage | undefined;
  saving: boolean;
  applying: boolean;
  onDraftChange: (serviceSlug: string, portKey: string, value: string) => void;
  onSave: (config: ServicePortConfig) => void;
  onApply: (config: ServicePortConfig) => void;
};

function ServicePortEditor({
  config,
  drafts,
  message,
  saving,
  applying,
  onDraftChange,
  onSave,
  onApply
}: PortEditorProps) {
  if (!config) {
    return null;
  }

  const pendingPorts = config.ports.filter((port) => port.pending);
  const hasPending = pendingPorts.length > 0;

  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-mist">Host ports</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Desired ports are saved before Docker recreates the service.
          </p>
        </div>
        <button
          className="btn-secondary min-h-9 px-3 py-1"
          disabled={saving || applying}
          type="button"
          onClick={() => onSave(config)}
        >
          <Save size={15} />
          {saving ? "Saving..." : "Save ports"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {config.ports.map((port) => (
          <label key={port.key} className="field-label">
            <span className="flex items-center justify-between gap-3">
              <span>{port.label}</span>
              <span className="text-xs font-semibold text-muted">{formatProtocols(port.protocols)}</span>
            </span>
            <input
              className="input-field"
              inputMode="numeric"
              pattern="[0-9]*"
              value={drafts?.[port.key] ?? String(port.desired_host_port)}
              onChange={(event) => onDraftChange(config.slug, port.key, event.target.value)}
              aria-label={`${config.name} ${port.label} host port`}
            />
            <span className="field-help">
              Running: {formatRunningPorts(port)}. Desired: {port.desired_host_port}. Container: {port.container_port}.
            </span>
          </label>
        ))}
      </div>

      {message ? (
        <p className={`mt-3 ${message.kind === "error" ? "error-callout" : "info-callout"}`}>{message.text}</p>
      ) : null}

      {hasPending ? (
        <div className="warning-callout mt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-warning">
                <AlertTriangle size={17} />
                Pending service port change
              </p>
              <p className="mt-2">
                {config.name} is still using its running Docker bindings. Recreate this service to apply the saved
                desired ports.
              </p>
            </div>
            <button className="btn-primary shrink-0" disabled={applying || saving} type="button" onClick={() => onApply(config)}>
              <RotateCcw size={16} />
              {applying ? "Recreating..." : `Recreate ${config.name}`}
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {pendingPorts.map((port) => (
              <div key={port.key} className="rounded-[12px] border border-warning/30 bg-deep/60 px-3 py-2">
                <p className="text-sm font-semibold text-mist">{port.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Running {formatRunningPorts(port)}. Pending desired {formatProtocols(port.protocols)}{" "}
                  {port.desired_host_port}.
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-muted">
            Keep pending is automatic. The current ports stay active until you recreate the service.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function ServicesPage() {
  const statuses = useFetch<ServiceStatus[]>("/api/services/status");
  const capabilities = useFetch<ServiceCapability[]>("/api/services/capabilities");
  const links = useFetch<ServiceLink[]>("/api/services/links");
  const portConfigs = useFetch<ServicePortConfig[]>("/api/services/ports");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [portDrafts, setPortDrafts] = useState<Record<string, Record<string, string>>>({});
  const [portMessages, setPortMessages] = useState<Record<string, PortMessage>>({});
  const [savingPortsFor, setSavingPortsFor] = useState<string | null>(null);
  const [applyingPortsFor, setApplyingPortsFor] = useState<string | null>(null);
  const capabilitiesBySlug = new Map((capabilities.data ?? []).map((capability) => [capability.slug, capability]));
  const portConfigsBySlug = useMemo(
    () => new Map((portConfigs.data ?? []).map((config) => [config.slug, config])),
    [portConfigs.data]
  );

  useEffect(() => {
    if (!portConfigs.data) {
      return;
    }
    setPortDrafts((current) => {
      const next = { ...current };
      for (const config of portConfigs.data ?? []) {
        const existing = next[config.slug] ?? {};
        next[config.slug] = Object.fromEntries(
          config.ports.map((port) => [port.key, existing[port.key] ?? String(port.desired_host_port)])
        );
      }
      return next;
    });
  }, [portConfigs.data]);

  const runServiceAction = async (service: ServiceStatus, action: string) => {
    const key = `${service.slug}:${action}`;
    setRunningAction(key);
    setActionMessage(null);
    try {
      const result = await api.post<ServiceActionResult>(`/api/services/${service.slug}/actions/${action}`);
      setActionMessage({ kind: "success", serviceSlug: service.slug, text: result.message });
      await statuses.refetch();
      await portConfigs.refetch();
    } catch (error) {
      setActionMessage({
        kind: "error",
        serviceSlug: service.slug,
        text: error instanceof Error ? error.message : "Service action failed."
      });
    } finally {
      setRunningAction(null);
    }
  };

  const updatePortDraft = (serviceSlug: string, portKey: string, value: string) => {
    setPortDrafts((current) => ({
      ...current,
      [serviceSlug]: {
        ...(current[serviceSlug] ?? {}),
        [portKey]: value
      }
    }));
    setPortMessages((current) => {
      const next = { ...current };
      delete next[serviceSlug];
      return next;
    });
  };

  const savePorts = async (config: ServicePortConfig) => {
    setSavingPortsFor(config.slug);
    setPortMessages((current) => {
      const next = { ...current };
      delete next[config.slug];
      return next;
    });

    try {
      const ports = parsePortDrafts(config, portDrafts[config.slug]);
      const updated = await api.patch<ServicePortConfig>(`/api/services/${config.slug}/ports`, { ports });
      portConfigs.setData((current) => (current ?? []).map((item) => (item.slug === updated.slug ? updated : item)));
      setPortDrafts((current) => ({
        ...current,
        [updated.slug]: Object.fromEntries(updated.ports.map((port) => [port.key, String(port.desired_host_port)]))
      }));
      setPortMessages((current) => ({
        ...current,
        [config.slug]: {
          kind: "success",
          text: updated.has_pending_port_change
            ? "Ports saved. Recreate the service when you are ready to apply them."
            : "Ports saved."
        }
      }));
    } catch (error) {
      setPortMessages((current) => ({
        ...current,
        [config.slug]: {
          kind: "error",
          text: error instanceof Error ? error.message : "Port settings could not be saved."
        }
      }));
    } finally {
      setSavingPortsFor(null);
    }
  };

  const applyPendingPorts = async (config: ServicePortConfig) => {
    const confirmed = window.confirm(
      `Recreate ${config.name} now to apply the pending port changes? The service may be briefly unavailable.`
    );
    if (!confirmed) {
      return;
    }

    setApplyingPortsFor(config.slug);
    setPortMessages((current) => {
      const next = { ...current };
      delete next[config.slug];
      return next;
    });

    try {
      const result = await api.post<ServiceActionResult>(`/api/services/${config.slug}/ports/apply`);
      setPortMessages((current) => ({
        ...current,
        [config.slug]: { kind: "success", text: result.message }
      }));
      await statuses.refetch();
      await portConfigs.refetch();
    } catch (error) {
      setPortMessages((current) => ({
        ...current,
        [config.slug]: {
          kind: "error",
          text: error instanceof Error ? error.message : "Service could not be recreated."
        }
      }));
    } finally {
      setApplyingPortsFor(null);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Services</p>
          <h1 className="page-title">Service control room</h1>
          <p className="page-copy">Monitor local services, inspect their purpose, and open their dashboards without losing operational context.</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <Panel title="Monitored services" description="Runtime state reported by the backend service checks.">
        {statuses.loading ? (
          <div className="space-y-3">
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
          </div>
        ) : null}
        {statuses.error ? <p className="error-callout">{statuses.error}</p> : null}
        {portConfigs.error ? <p className="error-callout">{portConfigs.error}</p> : null}
        <div className="space-y-4">
          {statuses.data?.map((service) => {
            const info = SERVICE_INFO[service.slug];
            const actions = actionsForStatus(service, capabilitiesBySlug.get(service.slug));
            const portConfig = portConfigsBySlug.get(service.slug);

            return (
              <article key={service.slug} className="raised-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Server className="text-accent" size={17} />
                      <p className="font-semibold text-mist">{service.name}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{service.detail}</p>
                  </div>
                  <StatusPill status={service.status} />
                </div>
                {actions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {actions.map((action) => {
                      const key = `${service.slug}:${action}`;
                      return (
                        <button
                          key={action}
                          className="btn-secondary min-h-9 px-3 py-1"
                          disabled={runningAction !== null}
                          aria-busy={runningAction === key}
                          type="button"
                          onClick={() => void runServiceAction(service, action)}
                        >
                          {runningAction === key ? "Working..." : actionLabel(action)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {actionMessage?.serviceSlug === service.slug ? (
                  <p className={`mt-3 ${actionMessage.kind === "error" ? "error-callout" : "info-callout"}`}>
                    {actionMessage.text}
                  </p>
                ) : null}
                <ServicePortEditor
                  config={portConfig}
                  drafts={portDrafts[service.slug]}
                  message={portMessages[service.slug]}
                  saving={savingPortsFor === service.slug}
                  applying={applyingPortsFor === service.slug}
                  onDraftChange={updatePortDraft}
                  onSave={(config) => void savePorts(config)}
                  onApply={(config) => void applyPendingPorts(config)}
                />
                {info ? (
                  <details className="group mt-4 border-t border-line pt-4">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-accent outline-none transition hover:text-accent-focus focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent/40">
                      <Info size={16} />
                      <span className="group-open:hidden">More info</span>
                      <span className="hidden group-open:inline">Hide info</span>
                    </summary>
                    <div className="mt-3 space-y-3 text-sm leading-6 text-muted">
                      <p>{info.summary}</p>
                      <p>{info.useCase}</p>
                      <div className="flex flex-wrap gap-2">
                        {info.links.map((link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-line bg-deep px-3 py-2 font-semibold text-mist transition duration-200 hover:border-accent/40 hover:bg-accent-soft"
                          >
                            <ExternalLink size={14} />
                            {link.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
          {statuses.data?.length === 0 ? <p className="empty-state">No monitored services are configured yet.</p> : null}
        </div>
      </Panel>
      <Panel title="Dashboards" description="Open linked service dashboards in a new browser context.">
        {links.loading ? <div className="skeleton h-28" /> : null}
        {links.error ? <p className="error-callout">{links.error}</p> : null}
        <div className="grid gap-4">
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
          {links.data?.length === 0 ? <p className="empty-state">No dashboard links are available.</p> : null}
        </div>
      </Panel>
      </div>
    </div>
  );
}
