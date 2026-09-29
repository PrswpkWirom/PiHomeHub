import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, Save, ServerCog, Wifi } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Field } from "../components/Field";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../contexts/AuthContext";
import { invalidateCache, invalidateCachePrefix, setCachedData, useFetch } from "../hooks/useFetch";
import type { AdminUser, AuditEventPage, AuditEventSummary, NotificationPreferences, PiStatus, SessionRead, TailscaleConnectionResult, TailscaleDevice, TailscaleStatus } from "../types/api";

export function GeneralSettingsPage() {
  return <Panel title="Appearance" description="Choose how PiHomeHub looks on this device."><ThemeToggle /></Panel>;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unavailable" : date.toLocaleString();
}

function passwordLength(value: string) {
  return Array.from(value).length;
}

const blockedPasswords = new Set(["admin", "password", "change-me", "change-me-now", "test-secret"]);

export function AccountSettingsPage() {
  const { user, endSession } = useAuth();
  const navigate = useNavigate();
  const sessions = useFetch<SessionRead[]>("/api/auth/sessions");
  const sessionControlsReady = !sessions.refreshing && Boolean(sessions.data?.some((session) => session.current));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<"password" | "all-sessions" | { session: SessionRead } | null>(null);
  const [sessionBusy, setSessionBusy] = useState<number | "logout" | "all" | null>(null);
  const busyRef = useRef(false);

  const clearPasswordFields = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setPasswordError(null);
  };

  useEffect(() => {
    const refreshVisibleSessions = () => {
      if (document.visibilityState === "visible") void sessions.refetch().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refreshVisibleSessions);
    return () => document.removeEventListener("visibilitychange", refreshVisibleSessions);
  }, [sessions.refetch]);

  const validatePassword = () => {
    if (!currentPassword) return "Enter your current password.";
    const length = passwordLength(newPassword);
    if (length < 12 || length > 1024) return "Use between 12 and 1024 characters for the new password.";
    if (blockedPasswords.has(newPassword.toLowerCase())) return "Choose a password that is not a known default.";
    if (newPassword !== confirmation) return "The new passwords do not match.";
    return null;
  };

  const currentPasswordError = passwordError === "Enter your current password." || passwordError === "Invalid credentials"
    || passwordError?.startsWith("current_password:") ? passwordError : undefined;
  const newPasswordError = passwordError === "Use between 12 and 1024 characters for the new password."
    || passwordError === "Choose a password that is not a known default."
    || passwordError?.startsWith("Password must be")
    || passwordError?.startsWith("new_password:") ? passwordError : undefined;
  const confirmationError = passwordError === "The new passwords do not match."
    || passwordError?.startsWith("confirmation:") ? passwordError : undefined;
  const generalPasswordError = passwordError && !currentPasswordError && !newPasswordError && !confirmationError ? passwordError : null;

  const submitPassword = async () => {
    if (busyRef.current) return;
    const validation = validatePassword();
    if (validation) {
      setPasswordError(validation);
      return;
    }
    busyRef.current = true;
    setPasswordBusy(true);
    setPasswordError(null);
    const payload = { current_password: currentPassword, new_password: newPassword };
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    try {
      await api.post("/api/auth/change-password", payload);
      endSession();
      navigate("/login", { replace: true, state: { notice: "Password changed. Sign in with your new password." } });
    } catch (error) {
      setPasswordError(error instanceof ApiError ? error.message : errorFeedback(error, "The password could not be changed.").text);
    } finally {
      busyRef.current = false;
      setPasswordBusy(false);
    }
  };

  const revokeSession = async (session: SessionRead) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSessionBusy(session.id);
    setFeedback({ kind: "progress", text: "Revoking session…" });
    try {
      await api.delete(`/api/auth/sessions/${session.id}`);
      await sessions.refetch();
      setFeedback({ kind: "success", text: "Session revoked." });
    } catch (error) {
      setFeedback(errorFeedback(error, "The session could not be revoked."));
      if (error instanceof ApiError && error.status === 404) {
        await sessions.refetch().catch(() => undefined);
        setFeedback({ kind: "warning", text: "That session is no longer active. The session list has been refreshed." });
      }
    } finally {
      busyRef.current = false;
      setSessionBusy(null);
    }
  };

  const logoutThisSession = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSessionBusy("logout");
    try {
      await api.post("/api/auth/logout");
      endSession("You have signed out.");
      navigate("/login", { replace: true, state: { notice: "You have signed out." } });
    } catch (error) {
      setFeedback(errorFeedback(error, "Sign out could not be completed."));
    } finally {
      busyRef.current = false;
      setSessionBusy(null);
    }
  };

  const logoutEverywhere = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSessionBusy("all");
    try {
      await api.post("/api/auth/logout-all");
      endSession();
      navigate("/login", { replace: true, state: { notice: "All sessions have been signed out." } });
    } catch (error) {
      setFeedback(errorFeedback(error, "Sessions could not be signed out."));
    } finally {
      busyRef.current = false;
      setSessionBusy(null);
    }
  };

  return (
    <div className="grid gap-5">
      <Panel title="Your account" description="Account details and personal security controls.">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="raised-card"><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Username</dt><dd className="mt-2 font-semibold text-mist">{user?.username ?? "Unavailable"}</dd></div>
          <div className="raised-card"><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Role</dt><dd className="mt-2 font-semibold text-mist">{user?.is_admin ? "Administrator" : "Viewer"}</dd></div>
          <div className="raised-card sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Password</dt><dd className="mt-2 text-sm text-mist">Last recorded password update: {formatDate(user?.password_changed_at)}</dd></div>
        </dl>
        <div className="mt-4">
          <button className="btn-secondary" type="button" onClick={() => { if (passwordOpen) clearPasswordFields(); setPasswordOpen(!passwordOpen); setPasswordError(null); }}>
            <KeyRound size={16} /> {passwordOpen ? "Cancel password change" : "Change password"}
          </button>
        </div>
        {passwordOpen ? (
          <form className="mt-5 grid max-w-xl gap-4 border-t border-line pt-5" onSubmit={(event: FormEvent) => { event.preventDefault(); setPasswordError(null); const error = validatePassword(); if (error) { setPasswordError(error); return; } setPendingConfirm("password"); }}>
            <Field label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordError(null); }} aria-invalid={Boolean(currentPasswordError)} help={currentPasswordError} required />
            <Field label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordError(null); }} aria-invalid={Boolean(newPasswordError)} help={newPasswordError ?? "Use at least 12 characters. Known default passwords are not accepted."} required />
            <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setPasswordError(null); }} aria-invalid={Boolean(confirmationError)} help={confirmationError} required />
            <FeedbackMessage feedback={generalPasswordError ? { kind: "error", persistent: true, text: generalPasswordError } : null} />
            <button className="btn-primary w-fit" disabled={passwordBusy} type="submit">{passwordBusy ? "Changing password…" : "Continue"}</button>
          </form>
        ) : null}
      </Panel>

      <Panel title="Active sessions" description="Sessions currently signed in to this account. Device and network details are shown only when the server recorded them." action={<button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={sessions.refreshing} onClick={() => void sessions.refetch().catch(() => undefined)}><RefreshCw size={15} className={sessions.refreshing ? "animate-spin" : ""} /> Refresh</button>}>
        {sessions.loading ? <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-24" /></div> : null}
        <FeedbackMessage feedback={sessions.error ? { kind: "error", persistent: true, text: sessions.error } : null} action={<button className="btn-secondary" type="button" onClick={() => void sessions.refetch().catch(() => undefined)}>Retry sessions</button>} />
        {!sessions.loading && !sessions.error && sessions.data && !sessionControlsReady ? <p id="sessions-not-ready" className="text-sm text-warning" role="status">Session controls are paused until the server confirms this browser session. Refresh the list to try again.</p> : null}
        <div className="space-y-3">
          {[...(sessions.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at)).map((session) => {
            return <article key={session.id} className="raised-card flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-mist">{session.current ? "This session" : "Other session"}</p>
                <dl className="mt-2 grid gap-x-5 gap-y-1 text-sm text-muted sm:grid-cols-2">
                  <div><dt className="inline">Created: </dt><dd className="inline">{formatDate(session.created_at)}</dd></div>
                  <div><dt className="inline">Last active: </dt><dd className="inline">{formatDate(session.last_seen_at)}</dd></div>
                  <div><dt className="inline">Expires: </dt><dd className="inline">{formatDate(session.expires_at)}</dd></div>
                  {session.source_ip ? <div><dt className="inline">Source IP: </dt><dd className="inline">{session.source_ip}</dd></div> : null}
                </dl>
                {session.user_agent ? <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Reported client</summary><p className="mt-1 break-words">{session.user_agent}</p></details> : null}
              </div>
              {!session.current ? <button className="btn-danger min-h-9 self-start px-3 py-1" type="button" disabled={!sessionControlsReady || sessionBusy !== null || passwordBusy} aria-describedby={!sessionControlsReady ? "sessions-not-ready" : undefined} onClick={() => setPendingConfirm({ session })}>Revoke session</button> : null}
            </article>;
          })}
          {!sessions.loading && !sessions.error && sessions.data?.length === 0 ? <p className="empty-state">No active sessions were returned. Refresh the list to check again.</p> : null}
        </div>
        <FeedbackMessage className="mt-3" feedback={feedback} onDismiss={() => setFeedback(null)} />
        <div className="mt-5 flex flex-wrap gap-3 border-t border-line pt-4">
          <button className="btn-secondary" type="button" disabled={!sessionControlsReady || sessionBusy !== null || passwordBusy} aria-describedby={!sessionControlsReady ? "sessions-not-ready" : undefined} onClick={() => void logoutThisSession()}>{sessionBusy === "logout" ? "Signing out…" : "Sign out this session"}</button>
          <button className="btn-danger" type="button" disabled={sessionBusy !== null || passwordBusy} onClick={() => setPendingConfirm("all-sessions")}>{sessionBusy === "all" ? "Signing out…" : "Log out everywhere"}</button>
        </div>
      </Panel>
      {pendingConfirm === "password" ? <ConfirmDialog title="Change password?" description="Changing your password will sign out every session, including this one. You will need to sign in again using the new password." confirmLabel="Change password" onCancel={() => { setPendingConfirm(null); clearPasswordFields(); }} onConfirm={() => { setPendingConfirm(null); void submitPassword(); }} /> : null}
      {pendingConfirm === "all-sessions" ? <ConfirmDialog title="Log out everywhere?" description="This revokes every session, including this browser. You will be sent to the sign-in page." confirmLabel="Log out everywhere" onCancel={() => setPendingConfirm(null)} onConfirm={() => { setPendingConfirm(null); void logoutEverywhere(); }} /> : null}
      {typeof pendingConfirm === "object" && pendingConfirm !== null ? <ConfirmDialog title="Revoke this session?" description="This session will be signed out. PiHomeHub will refresh the session list afterward." confirmLabel="Revoke session" onCancel={() => setPendingConfirm(null)} onConfirm={() => { setPendingConfirm(null); void revokeSession(pendingConfirm.session); }} /> : null}
    </div>
  );
}

export function AccessSettingsPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [tailnet, setTailnet] = useState("");
  const [message, setMessage] = useState<Feedback | null>(null);
  const [statusError, setStatusError] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const loadStatus = async () => {
    try {
      const nextStatus = await api.get<TailscaleStatus>("/api/tailscale/status");
      setStatus(nextStatus);
      setTailnet(nextStatus.tailnet ?? "");
      setStatusError(null);
    } catch (error) {
      setStatusError({ ...errorFeedback(error, "Tailscale status could not be loaded."), persistent: true });
      throw error;
    }
  };
  useEffect(() => { void loadStatus().catch(() => undefined); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage(null);
    try {
      const next = await api.post<TailscaleStatus>("/api/tailscale/settings", { api_token: apiToken || null, tailnet });
      setStatus(next); setApiToken(""); setMessage({ kind: "success", text: `Tailscale settings saved for ${next.tailnet ?? tailnet}.` });
      invalidateCache("/api/tailscale/devices"); invalidateCache("/api/tailscale/status");
    } catch (error) { setMessage(errorFeedback(error, "Tailscale settings could not be saved.")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const testConnection = async () => {
    if (!isAdmin || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage(null);
    try {
      const result = await api.post<TailscaleConnectionResult>("/api/tailscale/test");
      setMessage({ kind: result.ok ? "success" : "error", text: `Tailscale connection test ${result.ok ? "completed" : "failed"}: ${result.message}` });
    } catch (error) { setMessage(errorFeedback(error, "Tailscale connection test failed.")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const syncDevices = async () => {
    if (!isAdmin || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage(null);
    try {
      const devices = await api.post<TailscaleDevice[]>("/api/tailscale/sync");
      setCachedData<TailscaleDevice[]>("/api/tailscale/devices", devices);
      invalidateCache("/api/tailscale/status");
      await loadStatus().catch(() => undefined);
      setMessage({ kind: "success", text: `Tailscale sync completed for ${devices.length} devices.` });
    } catch (error) { setMessage(errorFeedback(error, "Tailscale device sync failed.")); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <Panel title="Tailscale" description="Token values remain write-only in the UI after saving.">
        {isAdmin ? <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-3 rounded-[18px] border border-line bg-deep p-4 text-sm text-muted sm:grid-cols-3">
            <div className="rounded-[14px] bg-card/70 p-3"><p className="text-xs font-semibold text-muted">Status</p><div className="mt-2">{status ? <StatusPill status={status.connected ? "connected" : "not connected"} /> : "Loading…"}</div></div>
            <div className="rounded-[14px] bg-card/70 p-3"><p className="text-xs font-semibold text-muted">Token</p><p className="mt-2 font-semibold text-mist">{status?.token_saved ? "Token saved" : "No token configured"}</p></div>
            <div className="rounded-[14px] bg-card/70 p-3"><p className="text-xs font-semibold text-muted">Last sync</p><p className="mt-2 text-sm tabular-nums text-mist">{status?.last_sync_at ?? "Never"}</p></div>
          </div>
          {status?.last_sync_error ? <FeedbackMessage feedback={{ kind: "warning", persistent: true, text: `Previous sync error: ${status.last_sync_error}` }} /> : null}
          <FeedbackMessage feedback={statusError} action={<button className="btn-secondary" type="button" onClick={() => void loadStatus().catch(() => undefined)}>Retry Tailscale status</button>} />
          <Field label="API token" type="password" autoComplete="off" value={apiToken} onChange={(event) => { setApiToken(event.target.value); setMessage(null); }} help={status?.token_saved ? "Enter a new token only when replacing it." : "Paste a Tailscale API token."} />
          <Field label="Tailnet" value={tailnet} onChange={(event) => { setTailnet(event.target.value); setMessage(null); }} required help="Use your tailnet name, example.com, or - for the default account." />
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy}><Save size={16} /> Save</button>
            <button className="btn-secondary" disabled={busy} type="button" onClick={() => void testConnection()}><Wifi size={16} /> Test connection</button>
            <button className="btn-secondary" disabled={busy} type="button" onClick={() => void syncDevices()}><RefreshCw className={busy ? "animate-spin" : ""} size={16} /> Sync devices now</button>
          </div>
          <FeedbackMessage feedback={message} onDismiss={() => setMessage(null)} />
        </form> : <div className="space-y-4">
          <p className="text-sm text-muted">Tailscale settings and sync controls require administrator access.</p>
          <dl className="grid gap-3 sm:grid-cols-3"><div className="raised-card"><dt className="text-xs text-muted">Status</dt><dd className="mt-2">{status ? <StatusPill status={status.connected ? "connected" : "not connected"} /> : "Loading…"}</dd></div><div className="raised-card"><dt className="text-xs text-muted">Token</dt><dd className="mt-2 font-semibold">{status?.token_saved ? "Token saved" : "No token configured"}</dd></div><div className="raised-card"><dt className="text-xs text-muted">Last sync</dt><dd className="mt-2">{status?.last_sync_at ?? "Never"}</dd></div></dl>
          {status?.last_sync_error ? <FeedbackMessage feedback={{ kind: "warning", persistent: true, text: `Previous sync error: ${status.last_sync_error}` }} /> : null}
          <FeedbackMessage feedback={statusError} action={<button className="btn-secondary" type="button" onClick={() => void loadStatus().catch(() => undefined)}>Retry Tailscale status</button>} />
        </div>}
      </Panel>
      <Panel title="Access model"><div className="raised-card flex gap-3"><KeyRound className="mt-0.5 shrink-0 text-accent" size={20} /><p className="text-sm leading-6 text-muted">PiHomeHub supports administrator and viewer accounts over private LAN or Tailscale access. Tailscale tokens remain write-only and are never displayed after saving.</p></div></Panel>
    </div>
  );
}

export function SystemSettingsPage() {
  const system = useFetch<PiStatus>("/api/system/pi");
  return <div className="grid gap-5 lg:grid-cols-2">
    <Panel title="Backend reported system information" description="These values describe the runtime that answered the request.">
      {system.loading ? <div className="skeleton h-32" /> : null}
      <FeedbackMessage feedback={system.error ? { kind: "error", persistent: true, text: system.error } : null} action={<button className="btn-secondary" type="button" onClick={() => void system.refetch()}>Retry system status</button>} />
      {system.data ? <dl className="grid grid-cols-2 gap-3 text-sm">{[["Hostname", system.data.hostname], ["Platform", system.data.platform], ["Local IP", system.data.local_ip ?? "Unavailable"], ["Uptime", `${Math.floor(system.data.uptime_seconds / 3600)} hours`], ["CPU", `${system.data.cpu_percent}%`], ["Memory", `${system.data.memory_percent}%`], ["Disk", `${system.data.disk_percent}%`], ["Temperature", system.data.temperature_c === null ? "Unavailable" : `${system.data.temperature_c}°C`]].map(([label, value]) => <div className="raised-card" key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-2 break-words text-mist">{value}</dd></div>)}</dl> : null}
    </Panel>
    <Panel title="Deployment notes"><div className="space-y-3"><div className="raised-card flex gap-3"><ServerCog className="mt-0.5 shrink-0 text-accent" size={20} /><p className="text-sm leading-6 text-muted">Use Caddy or a similar reverse proxy for HTTPS termination. Keep the dashboard off the public internet.</p></div><div className="raised-card flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-success" size={20} /><p className="text-sm leading-6 text-muted">LAN and Tailscale access should stay authenticated and limited to trusted devices.</p></div></div></Panel>
  </div>;
}

const auditCategories = ["all", "authentication", "users", "services", "system"] as const;
const eventLabels: Record<string, string> = {
  login_success: "Signed in", login_failure: "Sign-in failed", logout: "Signed out",
  reauthentication_success: "Confirmed identity", reauthentication_failure: "Identity confirmation failed",
  password_change: "Changed password", session_revocation: "Revoked a session",
  session_revocation_all: "Revoked all sessions", recent_authentication_denied: "Recent sign-in required",
  user_security_change: "Changed account access", authorization_denied: "Administrator access denied",
  device_create: "Added a device", device_update: "Updated a device", device_delete: "Deleted a device",
  wake_on_lan: "Sent a Wake-on-LAN packet", tailscale_settings_change: "Changed Tailscale settings",
  tailscale_connection_test: "Tested Tailscale connection", tailscale_sync: "Synced Tailscale devices",
  tailscale_device_wol_change: "Changed device wake settings", tailscale_device_settings_change: "Updated a Tailscale device",
  tailscale_wake_on_lan: "Sent a Tailscale device wake packet",
  service_start: "Started a service", service_stop: "Stopped a service", service_restart: "Restarted a service",
  service_port_configuration: "Changed service ports", service_port_apply: "Applied service ports"
};

function auditLabel(event: AuditEventSummary) {
  return eventLabels[event.event] ?? event.event.replace(/_/g, " ");
}

export function SecuritySettingsPage() {
  const [category, setCategory] = useState<(typeof auditCategories)[number]>("all");
  const [cursors, setCursors] = useState<Array<number | null>>([null]);
  const cursor = cursors[cursors.length - 1];
  const path = `/api/admin/audit-events/page?limit=50&category=${category}${cursor ? `&before_id=${cursor}` : ""}`;
  const page = useFetch<AuditEventPage>(path);
  const refreshFirstPage = () => {
    setCursors([null]);
    invalidateCache(`/api/admin/audit-events/page?limit=50&category=${category}`);
  };
  const older = () => { if (page.data?.next_cursor) setCursors((current) => [...current, page.data!.next_cursor]); };
  const newer = () => setCursors((current) => current.length > 1 ? current.slice(0, -1) : current);
  return <Panel title="Security events" description="Administrative actions and authentication events recorded by PiHomeHub." action={<button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={page.refreshing} onClick={refreshFirstPage}><RefreshCw size={15} /> Refresh</button>}>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter security events">
      {auditCategories.map((value) => <button key={value} className={`btn-secondary min-h-9 px-3 py-1 ${category === value ? "border-accent text-accent" : ""}`} type="button" aria-pressed={category === value} onClick={() => { setCategory(value); setCursors([null]); invalidateCache(`/api/admin/audit-events/page?limit=50&category=${value}`); }}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </div>
    {page.loading ? <div className="space-y-3"><div className="skeleton h-16" /><div className="skeleton h-16" /></div> : null}
    <FeedbackMessage feedback={page.error ? { kind: "error", persistent: true, text: page.error } : null} action={<button className="btn-secondary" type="button" onClick={() => void page.refetch().catch(() => undefined)}>Retry events</button>} />
    <div className="space-y-2">{page.data?.items.map((event) => <article key={event.id} className="raised-card flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="font-semibold text-mist">{auditLabel(event)} <span className="font-normal text-muted">· {event.success ? "Succeeded" : "Failed"}</span></p><p className="mt-1 text-sm text-muted">{event.actor_username ?? (event.actor_user_id ? `User #${event.actor_user_id}` : "Unknown actor")}{event.target_type ? ` · ${event.target_type}` : ""}{event.target_identifier ? ` #${event.target_identifier}` : ""}</p>{event.source_ip || event.request_id ? <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Event details</summary><p className="mt-1">{event.source_ip ? `Source IP: ${event.source_ip}` : ""}{event.source_ip && event.request_id ? " · " : ""}{event.request_id ? `Request ID: ${event.request_id}` : ""}</p></details> : null}</div><time className="shrink-0 text-xs tabular-nums text-muted">{formatDate(event.created_at)}</time></article>)}</div>
    {!page.loading && !page.error && page.data?.items.length === 0 ? <p className="empty-state">No events match this filter.</p> : null}
    <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={cursors.length <= 1} onClick={newer}>Newer</button><button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={!page.data?.next_cursor} onClick={older}>Older</button></div>
  </Panel>;
}

export function UsersSettingsPage() {
  const users = useFetch<AdminUser[]>("/api/admin/users");
  const { user: actor } = useAuth();
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<{ user: AdminUser; field: "is_admin" | "is_active"; next: boolean; label: string } | null>(null);
  const busy = useRef(false);
  const saveChange = async () => {
    if (!pending || busy.current) return;
    busy.current = true; setWorkingId(pending.user.id); setFeedback({ kind: "progress", text: `Updating ${pending.user.username}…` });
    const change = { [pending.field]: pending.next };
    try {
      await api.patch<AdminUser>(`/api/admin/users/${pending.user.id}`, change);
      await users.refetch();
      invalidateCachePrefix("/api/admin/audit-events/page?");
      setFeedback({ kind: "success", text: `${pending.user.username}: ${pending.label.toLowerCase()} updated.` });
    } catch (error) { setFeedback(errorFeedback(error, "The account could not be updated.")); }
    finally { busy.current = false; setWorkingId(null); setPending(null); }
  };
  return <Panel title="Users" description="Change account roles and sign-in access. Role and status changes revoke that account’s active sessions." action={<button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={users.refreshing} onClick={() => void users.refetch().catch(() => undefined)}><RefreshCw size={15} /> Refresh</button>}>
    {users.loading ? <div className="skeleton h-32" /> : null}
    <FeedbackMessage feedback={users.error ? { kind: "error", persistent: true, text: users.error } : null} action={<button className="btn-secondary" type="button" onClick={() => void users.refetch().catch(() => undefined)}>Retry users</button>} />
    <FeedbackMessage className="mb-4" feedback={feedback} onDismiss={() => setFeedback(null)} />
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[48rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead><tr className="text-xs uppercase tracking-wide text-muted"><th className="px-4 py-2">Account</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Sign-in</th><th className="px-4 py-2">Actions</th></tr></thead>
        <tbody>{users.data?.map((account) => {
          const self = account.id === actor?.id;
          const roleLabel = account.is_admin ? "Administrator" : "Viewer";
          const activeLabel = account.is_active ? "Enabled" : "Disabled";
          const selfDescription = `self-role-desktop-${account.id}`;
          return <tr key={account.id} className="bg-deep text-mist">
            <th scope="row" className="rounded-l-xl px-4 py-3 font-semibold">{account.username}{self ? <span className="ml-2 text-xs font-medium text-muted">You</span> : null}{self ? <p id={selfDescription} className="mt-1 text-xs font-normal text-muted">You cannot change your own administrator role or disable your account.</p> : null}</th>
            <td className="px-4 py-3">{roleLabel}</td>
            <td className="px-4 py-3">{activeLabel}</td>
            <td className="rounded-r-xl px-4 py-3"><div className="flex flex-wrap gap-2">
              <button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={self || workingId !== null} aria-describedby={self ? selfDescription : undefined} onClick={() => setPending({ user: account, field: "is_admin", next: !account.is_admin, label: account.is_admin ? "Demote to Viewer" : "Promote to Administrator" })}>{account.is_admin ? "Demote to Viewer" : "Promote to Administrator"}</button>
              <button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={self || workingId !== null} aria-describedby={self ? selfDescription : undefined} onClick={() => setPending({ user: account, field: "is_active", next: !account.is_active, label: account.is_active ? "Disable account" : "Enable account" })}>{account.is_active ? "Disable account" : "Enable account"}</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="space-y-3 lg:hidden">{users.data?.map((account) => {
      const self = account.id === actor?.id;
      const roleLabel = account.is_admin ? "Administrator" : "Viewer";
      const activeLabel = account.is_active ? "Enabled" : "Disabled";
      const selfDescription = `self-role-mobile-${account.id}`;
      return <article className="raised-card flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between" key={account.id}>
        <div><p className="font-semibold text-mist">{account.username}{self ? <span className="ml-2 text-xs font-medium text-muted">You</span> : null}</p><p className="mt-1 text-sm text-muted">{roleLabel} · {activeLabel}</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={self || workingId !== null} aria-describedby={self ? selfDescription : undefined} onClick={() => setPending({ user: account, field: "is_admin", next: !account.is_admin, label: account.is_admin ? "Demote to Viewer" : "Promote to Administrator" })}>{account.is_admin ? "Demote to Viewer" : "Promote to Administrator"}</button>
          <button className="btn-secondary min-h-9 px-3 py-1" type="button" disabled={self || workingId !== null} aria-describedby={self ? selfDescription : undefined} onClick={() => setPending({ user: account, field: "is_active", next: !account.is_active, label: account.is_active ? "Disable account" : "Enable account" })}>{account.is_active ? "Disable account" : "Enable account"}</button>
        </div>
        {self ? <p className="text-xs text-muted" id={selfDescription}>You cannot change your own administrator role or disable your account.</p> : null}
      </article>;
    })}</div>
    {!users.loading && !users.error && users.data?.length === 0 ? <p className="empty-state">No accounts found.</p> : null}
    {pending ? <ConfirmDialog title={`${pending.label}?`} description={`${pending.user.username} will become ${pending.field === "is_admin" ? (pending.next ? "an Administrator" : "a Viewer") : (pending.next ? "able to sign in" : "unable to sign in")}. This change revokes their active sessions.`} confirmLabel={pending.label} onCancel={() => setPending(null)} onConfirm={() => { setPending(null); void saveChange(); }} /> : null}
  </Panel>;
}

const notificationPreferenceGroups: Array<{ title: string; items: Array<{ key: keyof NotificationPreferences; label: string }> }> = [
  { title: "Devices", items: [{ key: "device_offline", label: "Device went offline" }, { key: "device_recovered", label: "Device came online" }] },
  { title: "Services", items: [{ key: "service_failure", label: "Service stopped or became unhealthy" }, { key: "service_recovered", label: "Service recovered or action completed" }] },
  { title: "System", items: [{ key: "temperature", label: "High temperature" }, { key: "disk", label: "Low disk space" }, { key: "memory", label: "High memory use" }, { key: "monitoring", label: "Monitoring unavailable or recovered" }] },
  { title: "Tailscale", items: [{ key: "tailscale_sync", label: "Synchronization failures and recovery" }] }
];

export function NotificationSettingsPage() {
  const stored = useFetch<NotificationPreferences>("/api/notifications/preferences");
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => { if (stored.data) setDraft(stored.data); }, [stored.data]);

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setFeedback({ kind: "progress", text: "Saving notification preferences…" });
    try {
      const saved = await api.patch<NotificationPreferences>("/api/notifications/preferences", draft);
      setDraft(saved); setCachedData("/api/notifications/preferences", saved);
      setFeedback({ kind: "success", text: "Notification preferences saved." });
    } catch (error) { setFeedback(errorFeedback(error, "Preferences could not be saved.")); }
    finally { setBusy(false); }
  };

  return <div className="grid gap-5">
    <Panel title="Notification delivery" description="Choose which future infrastructure events appear in your inbox. Monitoring continues for the whole hub.">
      {stored.loading && !draft ? <div className="skeleton h-40" /> : null}
      <FeedbackMessage feedback={stored.error ? { kind: "error", persistent: true, text: stored.error } : null} action={<button className="btn-secondary" type="button" onClick={() => void stored.refetch()}>Retry</button>} />
      <FeedbackMessage className="mb-4" feedback={feedback} onDismiss={() => setFeedback(null)} />
      <div className="grid gap-4 md:grid-cols-2">{notificationPreferenceGroups.map((group) => <section key={group.title} className="raised-card"><h2 className="font-semibold text-mist">{group.title}</h2><div className="mt-3 grid gap-3">{group.items.map(({ key, label }) => <label key={key} className="flex cursor-pointer items-center gap-3 text-sm text-muted"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--color-accent))]" checked={draft?.[key] ?? true} disabled={!draft || busy} onChange={(event) => setDraft((current) => current ? { ...current, [key]: event.target.checked } : current)} /><span>{label}</span></label>)}</div></section>)}</div>
      <div className="mt-5 flex justify-end"><button className="btn-primary" type="button" disabled={!draft || busy || stored.loading} onClick={() => void save()}>{busy ? "Saving…" : "Save preferences"}</button></div>
    </Panel>
  </div>;
}
