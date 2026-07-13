import { AlertTriangle, ClipboardCopy, ExternalLink, Info, RefreshCw, Save, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import { usePendingPortPolling } from "../hooks/usePendingPortPolling";
import type { ServiceActionResult, ServiceCapability, ServiceLink, ServicePortConfig, ServiceStatus } from "../types/api";
import { resolveServiceLinkUrl } from "../utils/serviceLinks";
import { resolvedPortFeedback } from "../utils/servicePortState";

type ServiceInfo = {
  summary: string;
  useCase: string;
  links: {
    label: string;
    url: string;
  }[];
};

type ActionMessage = {
  serviceSlug: string;
  feedback: Feedback;
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

function completedActionLabel(action: string) {
  return ({ start: "started", stop: "stopped", restart: "restarted" } as Record<string, string>)[action] ?? `${action} completed`;
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
  message: Feedback | undefined;
  saving: boolean;
  checking: boolean;
  pollingExpired: boolean;
  onDraftChange: (serviceSlug: string, portKey: string, value: string) => void;
  onSave: (config: ServicePortConfig) => void;
  onCopyCommand: (config: ServicePortConfig) => void;
  onCheckNow: (config: ServicePortConfig) => void;
  onDismissMessage: (serviceSlug: string) => void;
};

function ServicePortEditor({
  config,
  drafts,
  message,
  saving,
  checking,
  pollingExpired,
  onDraftChange,
  onSave,
  onCopyCommand,
  onCheckNow,
  onDismissMessage
}: PortEditorProps) {
  if (!config) {
    return null;
  }

  const pendingPorts = config.ports.filter((port) => port.pending);
  const hasPending = pendingPorts.length > 0;
  const webEditable = config.configuration_mode === "web";

  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-mist">Host ports</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            {webEditable
              ? "Desired ports are saved before Docker recreates the service."
              : "Ports are operator-managed in this Docker deployment and shown here as read-only values."}
          </p>
        </div>
        {webEditable ? (
          <button
            className="btn-secondary min-h-9 px-3 py-1"
            disabled={saving || checking}
            type="button"
            onClick={() => onSave(config)}
          >
            <Save size={15} />
            {saving ? "Saving..." : "Save ports"}
          </button>
        ) : null}
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
              disabled={!webEditable}
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

      <FeedbackMessage
        feedback={message}
        className="mt-3"
        onDismiss={() => onDismissMessage(config.slug)}
      />

      {hasPending ? (
        <div className="warning-callout mt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-warning">
                <AlertTriangle size={17} />
                Pending service port change
              </p>
              <p className="mt-2">
                {config.name} is still using its configured Docker bindings. Apply the saved ports with the operator
                command below; PiHomeHub will detect completion automatically.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-[12px] border border-warning/30 bg-deep/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Operator command</p>
            <code className="mt-2 block overflow-x-auto whitespace-nowrap font-mono text-xs text-mist">
              {config.operator_command}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary min-h-9 px-3 py-1" type="button" onClick={() => onCopyCommand(config)}>
                <ClipboardCopy size={15} />
                Copy command
              </button>
              <button
                className="btn-secondary min-h-9 px-3 py-1"
                disabled={checking || saving}
                type="button"
                onClick={() => onCheckNow(config)}
              >
                <RefreshCw className={checking ? "animate-spin" : ""} size={15} />
                {checking ? "Checking..." : "Check now"}
              </button>
            </div>
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
          <p className="mt-3 text-xs font-semibold text-muted" role="status" aria-live="polite">
            {pollingExpired
              ? "Automatic checks paused after 2 minutes. Use Check now after redeploying."
              : "Checking every 5 seconds. Current ports stay active until Docker Compose recreates the service."}
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
  const [portMessages, setPortMessages] = useState<Record<string, Feedback>>({});
  const [savingPortsFor, setSavingPortsFor] = useState<string | null>(null);
  const [checkingPortsFor, setCheckingPortsFor] = useState<string | null>(null);
  const pendingOrigins = useRef<Map<string, ServicePortConfig>>(new Map());
  const [awaitingVerification, setAwaitingVerification] = useState<Set<string>>(new Set());
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

  const dismissPortMessage = useCallback((serviceSlug: string) => {
    setPortMessages((current) => {
      const next = { ...current };
      delete next[serviceSlug];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!portConfigs.data) {
      return;
    }
    for (const config of portConfigs.data) {
      if (config.has_pending_port_change) {
        pendingOrigins.current.set(config.slug, config);
        setAwaitingVerification((current) => {
          const next = new Set(current);
          next.delete(config.slug);
          return next;
        });
        setPortMessages((messages) => {
          if (!messages[config.slug]?.text.includes("temporarily unavailable")) {
            return messages;
          }
          const next = { ...messages };
          delete next[config.slug];
          return next;
        });
        continue;
      }
      const origin = pendingOrigins.current.get(config.slug);
      if (!origin) {
        continue;
      }
      if (!config.bindings_verified) {
        setAwaitingVerification((current) => new Set([...current, config.slug]));
        setPortMessages((messages) => ({
          ...messages,
          [config.slug]: {
            kind: "warning",
            persistent: true,
            text: `${config.name} is temporarily unavailable while Docker bindings are being verified.`
          }
        }));
        continue;
      }
      const resolution = resolvedPortFeedback(origin, config);
      if (resolution) {
        setPortMessages((messages) => ({ ...messages, [config.slug]: resolution }));
      }
      pendingOrigins.current.delete(config.slug);
      setAwaitingVerification((current) => {
        const next = new Set(current);
        next.delete(config.slug);
        return next;
      });
    }
  }, [portConfigs.data]);

  const pendingSlugs = useMemo(
    () => Array.from(new Set([
      ...(portConfigs.data ?? []).filter((config) => config.has_pending_port_change).map((config) => config.slug),
      ...awaitingVerification
    ])),
    [awaitingVerification, portConfigs.data]
  );
  const pollPendingPorts = useCallback(
    () => Promise.all([portConfigs.refetch(), statuses.refetch()]),
    [portConfigs.refetch, statuses.refetch]
  );
  const {
    expiredSlugs: pollingExpired,
    error: pollingError,
    retry: retryPendingPortPoll
  } = usePendingPortPolling(pendingSlugs, pollPendingPorts);

  const runServiceAction = async (service: ServiceStatus, action: string) => {
    const key = `${service.slug}:${action}`;
    setRunningAction(key);
    setActionMessage(null);
    try {
      const result = await api.post<ServiceActionResult>(`/api/services/${service.slug}/actions/${action}`);
      if (!result.ok) {
        throw new Error(`${service.name} rejected the ${action} request.`);
      }
      try {
        const refreshed = await statuses.refetch();
        void portConfigs.refetch().catch(() => undefined);
        const current = refreshed.find((item) => item.slug === service.slug);
        const verified = action === "stop"
          ? current !== undefined && ["exited", "stopped"].includes(current.status)
          : current?.status === "running";
        setActionMessage({
          serviceSlug: service.slug,
          feedback: verified
            ? { kind: "success", text: `${service.name} ${completedActionLabel(action)}.` }
            : {
                kind: "warning",
                persistent: true,
                text: `${service.name} accepted the ${action} request, but its latest status is ${current?.status ?? "unknown"}. Check again before retrying.`
              }
        });
      } catch (refreshError) {
        setActionMessage({
          serviceSlug: service.slug,
          feedback: {
            kind: "warning",
            persistent: true,
            text: `${service.name} accepted the ${action} request, but status verification failed: ${refreshError instanceof Error ? refreshError.message : "status unavailable"}.`
          }
        });
      }
    } catch (error) {
      setActionMessage({ serviceSlug: service.slug, feedback: errorFeedback(error, `${service.name} action failed.`) });
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

    let ports: Record<string, number>;
    try {
      ports = parsePortDrafts(config, portDrafts[config.slug]);
    } catch (error) {
      setPortMessages((current) => ({
        ...current,
        [config.slug]: {
          kind: "error",
          persistent: true,
          text: error instanceof Error ? error.message : "Enter a valid host port."
        }
      }));
      setSavingPortsFor(null);
      return;
    }

    try {
      const updated = await api.patch<ServicePortConfig>(`/api/services/${config.slug}/ports`, { ports });
      portConfigs.setData((current) => (current ?? []).map((item) => (item.slug === updated.slug ? updated : item)));
      setPortDrafts((current) => ({
        ...current,
        [updated.slug]: Object.fromEntries(updated.ports.map((port) => [port.key, String(port.desired_host_port)]))
      }));
      const savedMappings = updated.ports
        .filter((port) => port.key in ports)
        .map((port) => `${port.label} ${formatProtocols(port.protocols)} ${port.desired_host_port}`)
        .join(", ");
      const saveFeedback: Feedback = updated.has_pending_port_change
        ? {
            kind: "success",
            persistent: true,
            text: `${updated.name}: ${savedMappings} saved. Run the operator command to apply the change.`
          }
        : updated.bindings_verified && updated.status === "running"
          ? { kind: "success", text: `${updated.name}: ${savedMappings} saved and already active.` }
          : updated.bindings_verified
            ? {
                kind: "warning",
                persistent: true,
                text: `${updated.name}: ${savedMappings} saved and configured, but the service is not running.`
              }
            : {
                kind: "success",
                persistent: true,
                text: `${updated.name}: ${savedMappings} saved. PiHomeHub will verify the bindings when the service is available.`
              };
      setPortMessages((current) => ({
        ...current,
        [config.slug]: saveFeedback
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

  const checkPendingPorts = async (config: ServicePortConfig) => {
    setCheckingPortsFor(config.slug);
    try {
      await retryPendingPortPoll();
    } catch (error) {
      setPortMessages((current) => ({
        ...current,
        [config.slug]: errorFeedback(error, `${config.name} status could not be checked.`)
      }));
    } finally {
      setCheckingPortsFor(null);
    }
  };

  const copyOperatorCommand = async (config: ServicePortConfig) => {
    try {
      await navigator.clipboard.writeText(config.operator_command);
      setPortMessages((current) => ({
        ...current,
        [config.slug]: { kind: "success", text: `${config.name} redeployment command copied.` }
      }));
    } catch (error) {
      setPortMessages((current) => ({
        ...current,
        [config.slug]: errorFeedback(error, "The command could not be copied. Select and copy it manually.")
      }));
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
        <FeedbackMessage
          feedback={statuses.error ? { kind: "error", persistent: true, text: statuses.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void statuses.refetch()}>Retry service status</button>}
        />
        <FeedbackMessage
          feedback={portConfigs.error ? { kind: "error", persistent: true, text: portConfigs.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void portConfigs.refetch()}>Retry port status</button>}
        />
        <FeedbackMessage
          feedback={pollingError ? { kind: "error", persistent: true, text: `Automatic port check failed: ${pollingError}` } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void retryPendingPortPoll().catch(() => undefined)}>Retry pending port check</button>}
        />
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
                  <FeedbackMessage
                    feedback={actionMessage.feedback}
                    className="mt-3"
                    onDismiss={() => setActionMessage(null)}
                  />
                ) : null}
                <ServicePortEditor
                  config={portConfig}
                  drafts={portDrafts[service.slug]}
                  message={portMessages[service.slug]}
                  saving={savingPortsFor === service.slug}
                  checking={checkingPortsFor === service.slug}
                  pollingExpired={pollingExpired.has(service.slug)}
                  onDraftChange={updatePortDraft}
                  onSave={(config) => void savePorts(config)}
                  onCopyCommand={(config) => void copyOperatorCommand(config)}
                  onCheckNow={(config) => void checkPendingPorts(config)}
                  onDismissMessage={dismissPortMessage}
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
        <FeedbackMessage
          feedback={links.error ? { kind: "error", persistent: true, text: links.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void links.refetch()}>Retry dashboard links</button>}
        />
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
