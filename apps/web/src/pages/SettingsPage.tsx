import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, Save, ServerCog, Wifi } from "lucide-react";

import { api } from "../api/client";
import { Field } from "../components/Field";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { invalidateCache, setCachedData } from "../hooks/useFetch";
import type { TailscaleConnectionResult, TailscaleDevice, TailscaleStatus } from "../types/api";

export function SettingsPage() {
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [tailnet, setTailnet] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    const nextStatus = await api.get<TailscaleStatus>("/api/tailscale/status");
    setStatus(nextStatus);
    setTailnet(nextStatus.tailnet ?? "");
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await api.post<TailscaleStatus>("/api/tailscale/settings", {
        api_token: apiToken || null,
        tailnet
      });
      setStatus(nextStatus);
      invalidateCache("/api/tailscale/devices");
      invalidateCache("/api/tailscale/status");
      setApiToken("");
      setMessage("Tailscale settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save Tailscale settings.");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.post<TailscaleConnectionResult>("/api/tailscale/test");
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setBusy(false);
    }
  };

  const syncDevices = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const devices = await api.post<TailscaleDevice[]>("/api/tailscale/sync");
      setCachedData<TailscaleDevice[]>("/api/tailscale/devices", devices);
      invalidateCache("/api/tailscale/status");
      await loadStatus();
      setMessage(`Synced ${devices.length} Tailscale devices.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tailscale sync failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 className="page-title">Private access settings</h1>
          <p className="page-copy">Manage Tailscale connection details and keep deployment guidance close to the controls.</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <Panel title="Tailscale" description="Token values remain write-only in the UI after saving.">
        <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-3 rounded-[18px] border border-line bg-deep p-4 text-sm text-muted sm:grid-cols-3">
            <div className="rounded-[14px] bg-card/70 p-3">
              <p className="text-xs font-semibold text-muted">Status</p>
              <div className="mt-2">
                {status ? <StatusPill status={status.connected ? "connected" : "not connected"} /> : <span className="text-muted">Loading...</span>}
              </div>
            </div>
            <div className="rounded-[14px] bg-card/70 p-3">
              <p className="text-xs font-semibold text-muted">Token</p>
              <p className="mt-2 font-semibold text-mist">{status?.token_saved ? "Token saved" : "No token configured"}</p>
            </div>
            <div className="rounded-[14px] bg-card/70 p-3">
              <p className="text-xs font-semibold text-muted">Last sync</p>
              <p className="mt-2 font-mono text-sm tabular-nums text-mist">{status?.last_sync_at ?? "Never"}</p>
            </div>
          </div>
          {status?.last_sync_error ? <p className="error-callout">Last error: {status.last_sync_error}</p> : null}
          <Field
            label="API token"
            help={status?.token_saved ? "Token saved. Enter a new token only when replacing it." : "Paste a Tailscale API token."}
            type="password"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
            autoComplete="off"
          />
          <Field
            label="Tailnet"
            help="Use your tailnet name, example.com, or - for the default account."
            value={tailnet}
            onChange={(event) => setTailnet(event.target.value)}
            required
          />
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy}>
              <Save size={16} />
              Save
            </button>
            <button className="btn-secondary" disabled={busy} type="button" onClick={() => void testConnection()}>
              <Wifi size={16} />
              Test connection
            </button>
            <button className="btn-secondary" disabled={busy} type="button" onClick={() => void syncDevices()}>
              <RefreshCw className={busy ? "animate-spin" : ""} size={16} />
              Sync devices now
            </button>
          </div>
          {message ? <p className="info-callout">{message}</p> : null}
        </form>
      </Panel>

      <div className="grid gap-5">
      <Panel title="Access model">
        <div className="raised-card flex gap-3">
          <KeyRound className="mt-0.5 shrink-0 text-accent" size={20} />
          <p className="text-sm leading-6 text-muted">PiHomeHub uses a single admin account and private access through LAN or Tailscale. Tailscale tokens are write-only in the UI and are never displayed after saving.</p>
        </div>
      </Panel>
      <Panel title="Deployment notes">
        <div className="space-y-3">
          <div className="raised-card flex gap-3">
            <ServerCog className="mt-0.5 shrink-0 text-accent" size={20} />
            <p className="text-sm leading-6 text-muted">Use Caddy or a similar reverse proxy for HTTPS termination. Keep the dashboard off the public internet.</p>
          </div>
          <div className="raised-card flex gap-3">
            <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={20} />
            <p className="text-sm leading-6 text-muted">LAN and Tailscale access should stay authenticated and limited to trusted devices.</p>
          </div>
        </div>
      </Panel>
      </div>
      </div>
    </div>
  );
}
