import { ExternalLink, Info, Server } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { ServiceActionResult, ServiceCapability, ServiceLink, ServiceStatus } from "../types/api";

type ServiceInfo = {
  summary: string;
  useCase: string;
  links: {
    label: string;
    url: string;
  }[];
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

export function ServicesPage() {
  const statuses = useFetch<ServiceStatus[]>("/api/services/status");
  const capabilities = useFetch<ServiceCapability[]>("/api/services/capabilities");
  const links = useFetch<ServiceLink[]>("/api/services/links");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const capabilitiesBySlug = new Map((capabilities.data ?? []).map((capability) => [capability.slug, capability]));

  const runServiceAction = async (service: ServiceStatus, action: string) => {
    const key = `${service.slug}:${action}`;
    setRunningAction(key);
    setActionMessage(null);
    try {
      const result = await api.post<ServiceActionResult>(`/api/services/${service.slug}/actions/${action}`);
      setActionMessage(`${service.name}: ${result.message}`);
      await statuses.refetch();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Service action failed.");
    } finally {
      setRunningAction(null);
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
        <div className="space-y-4">
          {statuses.data?.map((service) => {
            const info = SERVICE_INFO[service.slug];
            const actions = actionsForStatus(service, capabilitiesBySlug.get(service.slug));

            return (
              <article key={service.slug} className="raised-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Server className="text-accent" size={17} />
                      <p className="font-semibold text-white">{service.name}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{service.detail}</p>
                  </div>
                  <StatusPill status={service.status} />
                </div>
                {actions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-white/70 pt-3">
                    {actions.map((action) => {
                      const key = `${service.slug}:${action}`;
                      return (
                        <button
                          key={action}
                          className="rounded-full border border-ink px-3 py-1 text-sm font-semibold text-ink disabled:opacity-40"
                          disabled={runningAction !== null}
                          type="button"
                          onClick={() => void runServiceAction(service, action)}
                        >
                          {runningAction === key ? "Working..." : actionLabel(action)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {info ? (
                  <details className="group mt-4 border-t border-line pt-4">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-accent outline-none transition hover:text-white focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent/40">
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
                            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white/[0.04] px-3 py-2 font-semibold text-mist transition duration-200 hover:border-accent/40 hover:bg-accent-soft hover:text-white"
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
          {actionMessage ? <p className="text-sm text-slate-700">{actionMessage}</p> : null}
        </div>
      </Panel>
      <Panel title="Dashboards" description="Open linked service dashboards in a new browser context.">
        {links.loading ? <div className="skeleton h-28" /> : null}
        {links.error ? <p className="error-callout">{links.error}</p> : null}
        <div className="grid gap-4">
          {links.data?.map((link) => (
            <a key={link.slug} href={link.url} target="_blank" rel="noreferrer" className="raised-card group block transition duration-200 hover:-translate-y-0.5 hover:border-accent/35">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white">{link.name}</p>
                <ExternalLink className="text-muted transition group-hover:text-accent" size={16} />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted">{link.description ?? link.url}</p>
            </a>
          ))}
          {links.data?.length === 0 ? <p className="empty-state">No dashboard links are available.</p> : null}
        </div>
      </Panel>
      </div>
    </div>
  );
}
