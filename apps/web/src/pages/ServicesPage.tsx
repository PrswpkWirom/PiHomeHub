import { AlertTriangle, ClipboardCopy, ExternalLink, Info, Pencil, Plus, RefreshCw, Save, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import { usePermissions } from "../components/AdminOnly";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Panel } from "../components/Panel";
import { ServiceLinkEditor } from "../components/ServiceLinkEditor";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import { usePendingPortPolling } from "../hooks/usePendingPortPolling";
import type { ServiceActionResult, ServiceCapability, ServiceLink, ServiceOperation, ServicePortConfig, ServiceStatus } from "../types/api";
import { dashboardLinks, serviceLinkHref } from "../utils/serviceLinks";
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
  operationId?: string;
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
    return service.setup_required ? [] : ["create"].filter((action) => capability.actions.includes(action));
  }
  if (service.status === "running") {
    return ["stop", "restart"].filter((action) => capability.actions.includes(action));
  }
  if (["created", "exited", "dead", "stopped"].includes(service.status)) {
    return ["start"].filter((action) => capability.actions.includes(action));
  }
  return [];
}

function makeOperationId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
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
  message: Feedback | undefined;
  saving: boolean;
  checking: boolean;
  canAdmin: boolean;
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
  canAdmin,
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
            disabled={saving || checking || !canAdmin}
            aria-describedby={!canAdmin ? `port-admin-required-${config.slug}` : undefined}
            type="button"
            onClick={() => onSave(config)}
          >
            <Save size={15} />
            {saving ? "Saving..." : "Save ports"}
          </button>
        ) : null}
      </div>
      {webEditable && !canAdmin ? <p id={`port-admin-required-${config.slug}`} className="mt-2 text-xs text-muted">Administrator access required to change ports.</p> : null}

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
              disabled={!webEditable || !canAdmin}
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
            {canAdmin ? <code className="mt-2 block overflow-x-auto whitespace-nowrap font-mono text-xs text-mist">{config.operator_command}</code> : <p className="mt-2 text-xs text-muted">Operator instructions require administrator access.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {canAdmin ? <button className="btn-secondary min-h-9 px-3 py-1" type="button" onClick={() => onCopyCommand(config)}>
                <ClipboardCopy size={15} />
                Copy command
              </button> : null}
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
  const { isAdmin } = usePermissions();
  const statuses = useFetch<ServiceStatus[]>("/api/services/status");
  const capabilities = useFetch<ServiceCapability[]>("/api/services/capabilities");
  const links = useFetch<ServiceLink[]>("/api/services/links");
  const portConfigs = useFetch<ServicePortConfig[]>("/api/services/ports");
  const [editingLink, setEditingLink] = useState<ServiceLink | null | undefined>(undefined);
  const [linkFeedback, setLinkFeedback] = useState<Feedback | null>(null);
  const [submittingBySlug, setSubmittingBySlug] = useState<Record<string, boolean>>({});
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [portDrafts, setPortDrafts] = useState<Record<string, Record<string, string>>>({});
  const [portMessages, setPortMessages] = useState<Record<string, Feedback>>({});
  const [savingPortsFor, setSavingPortsFor] = useState<string | null>(null);
  const [checkingPortsFor, setCheckingPortsFor] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ service: ServiceStatus; action: string } | null>(null);
  const [pendingPortSave, setPendingPortSave] = useState<ServicePortConfig | null>(null);
  const actionLock = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState<Record<string, { action: string; operationId: string }>>(() => {
    try { return JSON.parse(sessionStorage.getItem("pihomehub-service-operations") ?? "{}"); } catch { return {}; }
  });
  const pendingOrigins = useRef<Map<string, ServicePortConfig>>(new Map());
  const [awaitingVerification, setAwaitingVerification] = useState<Set<string>>(new Set());
  const [statusRetryAttempt, setStatusRetryAttempt] = useState(0);
  const quickLinks = useMemo(() => dashboardLinks(links.data, statuses.data), [links.data, statuses.data]);
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

  const rememberUnconfirmed = (next: Record<string, { action: string; operationId: string }>) => {
    setUnconfirmed(next);
    try { sessionStorage.setItem("pihomehub-service-operations", JSON.stringify(next)); } catch { /* Status remains available from the server. */ }
  };

  useEffect(() => {
    if (!statuses.data) return;
    let changed = false;
    const next = { ...unconfirmed };
    for (const service of statuses.data) {
      if (next[service.slug] && next[service.slug].operationId === service.operation?.operation_id) {
        delete next[service.slug];
        changed = true;
      }
    }
    if (changed) rememberUnconfirmed(next);
  }, [statuses.data, unconfirmed]);

  useEffect(() => {
    if (!actionMessage?.operationId || !statuses.data || statuses.error) return;
    const latest = statuses.data.find((service) => service.slug === actionMessage.serviceSlug)?.operation;
    if (latest?.operation_id === actionMessage.operationId) setActionMessage(null);
  }, [actionMessage, statuses.data, statuses.error]);

  const submitServiceAction = async (service: ServiceStatus, action: string, operationId = makeOperationId()) => {
    if (!isAdmin || submittingBySlug[service.slug]) return;
    setSubmittingBySlug((current) => ({ ...current, [service.slug]: true }));
    setActionMessage(null);
    const pending = { ...unconfirmed, [service.slug]: { action, operationId } };
    rememberUnconfirmed(pending);
    try {
      const accepted = await api.post<ServiceActionResult>(`/api/services/${service.slug}/actions/${action}`, { operation_id: operationId });
      if (accepted.operation) {
        statuses.setData((current) => (current ?? []).map((item) => item.slug === service.slug
          ? { ...item, operation: accepted.operation }
          : item));
      }
      const next = { ...pending };
      delete next[service.slug];
      rememberUnconfirmed(next);
      void statuses.refetch().catch(() => undefined);
      void portConfigs.refetch().catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        const next = { ...pending };
        delete next[service.slug];
        rememberUnconfirmed(next);
      }
      setActionMessage({
        serviceSlug: service.slug,
        operationId,
        feedback: { kind: error instanceof ApiError && error.status >= 400 && error.status < 500 ? "error" : "warning", persistent: true, text: `${service.name}: ${error instanceof Error ? error.message : "The operation response was interrupted."} Check progress before retrying.` }
      });
      void statuses.refetch().catch(() => undefined);
    } finally {
      setSubmittingBySlug((current) => ({ ...current, [service.slug]: false }));
    }
  };

  const checkServiceOperation = async (service: ServiceStatus) => {
    const unconfirmedOperation = unconfirmed[service.slug];
    setSubmittingBySlug((current) => ({ ...current, [service.slug]: true }));
    try {
      if (unconfirmedOperation) {
        try {
          const operation = await api.get<ServiceOperation>(`/api/services/operations/${unconfirmedOperation.operationId}`);
          statuses.setData((current) => (current ?? []).map((item) => item.slug === service.slug ? { ...item, operation } : item));
        } catch {
          const accepted = await api.post<ServiceActionResult>(`/api/services/${service.slug}/actions/${unconfirmedOperation.action}`, {
            operation_id: unconfirmedOperation.operationId
          });
          if (accepted.operation) {
            statuses.setData((current) => (current ?? []).map((item) => item.slug === service.slug ? { ...item, operation: accepted.operation } : item));
          }
        }
        const next = { ...unconfirmed };
        delete next[service.slug];
        rememberUnconfirmed(next);
      } else if (service.operation) {
        const operation = await api.get<ServiceOperation>(`/api/services/operations/${service.operation.operation_id}`);
        statuses.setData((current) => (current ?? []).map((item) => item.slug === service.slug ? { ...item, operation } : item));
      }
      await statuses.refetch();
      setActionMessage((current) => current?.serviceSlug === service.slug ? null : current);
    } catch (error) {
      setActionMessage({ serviceSlug: service.slug, operationId: unconfirmedOperation?.operationId ?? service.operation?.operation_id,
        feedback: errorFeedback(error, "Operation status is temporarily unavailable.") });
    } finally {
      setSubmittingBySlug((current) => ({ ...current, [service.slug]: false }));
    }
  };

  const activeOperation = (operation: ServiceOperation | null | undefined) =>
    Boolean(operation && ["queued", "running", "verifying", "unknown"].includes(operation.state));

  useEffect(() => {
    const hasActiveOperation = Boolean(Object.keys(unconfirmed).length)
      || (statuses.data?.some((service) => activeOperation(service.operation)) ?? false);
    const interval = statuses.error
      ? Math.min(60_000, 2_000 * (2 ** Math.min(statusRetryAttempt, 5)))
      : hasActiveOperation ? 2_000 : 15_000;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void statuses.refetch().then(() => setStatusRetryAttempt(0)).catch(() => setStatusRetryAttempt((attempt) => attempt + 1));
    };
    const timer = window.setInterval(refresh, interval);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [statuses.data, statuses.error, statuses.refetch, statusRetryAttempt, unconfirmed]);

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
    if (!isAdmin || actionLock.current) return;
    actionLock.current = true;
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
      actionLock.current = false;
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
      actionLock.current = false;
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
    if (!isAdmin) return;
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
          feedback={statuses.error ? { kind: "warning", persistent: true, text: statuses.data ? `Showing stale service status. Refresh failed: ${statuses.error}` : statuses.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void statuses.refetch().catch(() => undefined)}>Retry service status</button>}
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
          {!isAdmin && statuses.data?.some((service) => actionsForStatus(service, capabilitiesBySlug.get(service.slug)).length > 0) ? <p className="text-sm text-muted">Service controls require administrator access.</p> : null}
          {statuses.data?.map((service) => {
            const info = SERVICE_INFO[service.slug];
            const dashboardLink = quickLinks.find((link) => link.slug === service.slug);
            const dashboardUrl = dashboardLink ? serviceLinkHref(dashboardLink) : service.url;
            const actions = actionsForStatus(service, capabilitiesBySlug.get(service.slug));
            const portConfig = portConfigsBySlug.get(service.slug);
            const outstandingRequest = unconfirmed[service.slug];
            const pendingResponse = Boolean(outstandingRequest && outstandingRequest.operationId !== service.operation?.operation_id);

            return (
              <article key={service.slug} className="raised-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Server className="text-accent" size={17} />
                      <p className="font-semibold text-mist">{service.name}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{service.detail}</p>
                    {service.status === "running" && dashboardUrl ? <a className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent-focus" href={dashboardUrl ?? undefined} target="_blank" rel="noreferrer">Open dashboard <ExternalLink size={14} /></a> : null}
                    {service.status === "running" ? <p className={`mt-1 text-xs font-semibold ${service.health_status === "unhealthy" ? "text-amber-400" : service.health_status === "healthy" ? "text-emerald-400" : "text-muted"}`}>Application health: {service.health_status ?? "No health check configured"}</p> : null}
                  </div>
                  <StatusPill status={service.status} />
                </div>
                {actions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {actions.map((action) => (
                      <button
                        key={action}
                        className="btn-secondary min-h-9 px-3 py-1"
                        disabled={Boolean(submittingBySlug[service.slug]) || activeOperation(service.operation) || Boolean(statuses.error) || statuses.refreshing || !isAdmin}
                        aria-describedby={!isAdmin ? `service-admin-required-${service.slug}` : undefined}
                        aria-busy={Boolean(submittingBySlug[service.slug])}
                        type="button"
                        onClick={() => {
                          if (action === "stop" || action === "restart") setPendingAction({ service, action });
                          else void submitServiceAction(service, action);
                        }}
                      >
                        {submittingBySlug[service.slug] ? "Sending..." : action === "create" ? "Create and start" : actionLabel(action)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!isAdmin && actions.length > 0 ? <p id={`service-admin-required-${service.slug}`} className="mt-2 text-xs text-muted">Administrator access required</p> : null}
                {service.setup_required ? <p className="mt-3 text-sm text-amber-300">Setup required: create Mosquitto credentials and add an allowed user to <code>infra/mosquitto/generated/acl</code>, then run <code>scripts/generate-service-config.py</code>.</p> : null}
                {service.operation || outstandingRequest ? (
                  <div className={`mt-3 rounded-xl border px-3 py-3 ${!pendingResponse && service.operation?.state === "failed" ? "border-red-400/40 bg-red-950/20" : !pendingResponse && service.operation?.state === "unknown" ? "border-amber-400/40 bg-amber-950/20" : !pendingResponse && service.operation?.state === "succeeded" ? "border-emerald-400/30 bg-emerald-950/10" : "border-line bg-deep/60"}`} role="status" aria-live="polite">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-mist">{actionLabel(pendingResponse ? outstandingRequest.action : service.operation?.action ?? "service")} · {pendingResponse ? "Request status unconfirmed" : service.operation?.state === "succeeded" ? "Complete" : service.operation?.state === "failed" ? "Failed" : service.operation?.state === "unknown" ? "Needs status check" : `${(service.operation?.stage ?? "Queued").charAt(0).toUpperCase()}${(service.operation?.stage ?? "queued").slice(1)}...`}</p>
                      {pendingResponse || activeOperation(service.operation) || service.operation?.state === "failed" ? <button className="btn-secondary min-h-8 px-3 py-1 text-xs" disabled={Boolean(submittingBySlug[service.slug])} type="button" onClick={() => void checkServiceOperation(service)}>{submittingBySlug[service.slug] ? "Checking..." : "Check progress"}</button> : null}
                    </div>
                    {!pendingResponse && service.operation?.message ? <p className="mt-2 text-sm text-muted">{service.operation.message}</p> : pendingResponse ? <p className="mt-2 text-sm text-muted">PiHomeHub may already be processing this request. Check its saved operation before trying again.</p> : null}
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
                  canAdmin={isAdmin}
                  pollingExpired={pollingExpired.has(service.slug)}
                  onDraftChange={updatePortDraft}
                  onSave={(config) => setPendingPortSave(config)}
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
      <Panel title="Dashboards" description="Open service dashboards and your own quick links." action={isAdmin ? <button className="btn-secondary whitespace-nowrap" type="button" disabled={editingLink !== undefined || links.loading || Boolean(links.error)} onClick={() => { setLinkFeedback(null); setEditingLink(null); }}><Plus size={16} />Add quick link</button> : undefined}>
        {!isAdmin ? <p className="mb-4 text-sm text-muted">Administrator access required to add or edit links.</p> : null}
        {editingLink !== undefined && isAdmin ? <ServiceLinkEditor key={editingLink?.slug ?? "new"} link={editingLink} onCancel={() => setEditingLink(undefined)} onSave={(saved) => {
          links.setData((current) => [...(current ?? []).filter((link) => link.slug !== saved.slug), saved]);
          setEditingLink(undefined);
          setLinkFeedback({ kind: "success", text: `${saved.name} link saved.` });
        }} /> : null}
        <FeedbackMessage feedback={linkFeedback} onDismiss={() => setLinkFeedback(null)} className="mb-4" />
        {links.loading ? <div className="skeleton h-28" /> : null}
        <FeedbackMessage
          feedback={links.error ? { kind: "error", persistent: true, text: links.error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void links.refetch()}>Retry dashboard links</button>}
        />
        <div className="grid gap-4">
          {quickLinks.map((link) => {
            const resolvedUrl = serviceLinkHref(link);
            return (
              <article key={link.slug} className="raised-card min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <a href={resolvedUrl} target="_blank" rel="noreferrer" className="group min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold text-mist group-hover:text-accent">{link.name}<ExternalLink className="shrink-0" size={16} /></span>
                    {link.description ? <p className="mt-2 text-sm leading-6 text-muted">{link.description}</p> : null}
                    <p className="mt-2 break-all text-xs leading-5 text-accent">{resolvedUrl}</p>
                  </a>
                  {isAdmin ? <button className="btn-secondary min-h-9 shrink-0 px-3 py-1" type="button" aria-label={`Edit ${link.name} link`} disabled={editingLink !== undefined || links.loading || Boolean(links.error)} onClick={() => { setLinkFeedback(null); setEditingLink(link); }}><Pencil size={14} />Edit</button> : null}
                </div>
                <p className="mt-2 text-xs text-muted">{link.url_override ? "Saved link" : link.id < 0 ? "Automatic link" : "Default link"}</p>
              </article>
            );
          })}
          {quickLinks.length === 0 ? <p className="empty-state">No running service dashboards or saved links are available.</p> : null}
        </div>
      </Panel>
      {pendingAction ? <ConfirmDialog title={`${pendingAction.action === "stop" ? "Stop" : "Restart"} ${pendingAction.service.name}?`} description={`This sends a ${pendingAction.action} request to ${pendingAction.service.name}.`} confirmLabel={`${pendingAction.action === "stop" ? "Stop" : "Restart"} service`} onCancel={() => setPendingAction(null)} onConfirm={() => { const target = pendingAction; setPendingAction(null); void submitServiceAction(target.service, target.action); }} /> : null}
      {pendingPortSave ? <ConfirmDialog title={`Save ${pendingPortSave.name} ports?`} description="PiHomeHub will save the desired host ports. In operator-managed deployments, the running Docker bindings change only after an operator redeploys the service." confirmLabel="Save ports" onCancel={() => setPendingPortSave(null)} onConfirm={() => { const target = pendingPortSave; setPendingPortSave(null); void savePorts(target); }} /> : null}
      </div>
    </div>
  );
}
