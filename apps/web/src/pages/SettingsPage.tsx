import { FormEvent, useEffect, useState } from "react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
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
      await loadStatus();
      setMessage(`Synced ${devices.length} Tailscale devices.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tailscale sync failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Tailscale">
        <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-3 rounded-2xl bg-clay p-4 text-sm text-slate-700">
            <p>Status: {status?.connected ? "Connected" : "Not connected"}</p>
            <p>Token: {status?.token_saved ? "Token saved" : "No token configured"}</p>
            <p>Last sync: {status?.last_sync_at ?? "Never"}</p>
            {status?.last_sync_error ? <p className="text-red-700">Last error: {status.last_sync_error}</p> : null}
          </div>
          <label className="block text-sm font-semibold text-ink">
            API token
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3"
              placeholder={status?.token_saved ? "Token saved. Enter a new token to replace it." : "tskey-..."}
              type="password"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Tailnet
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3"
              placeholder="example.com or -"
              value={tailnet}
              onChange={(event) => setTailnet(event.target.value)}
              required
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white" disabled={busy}>
              Save
            </button>
            <button className="rounded-full border border-ink px-5 py-3 text-sm font-semibold text-ink" disabled={busy} type="button" onClick={() => void testConnection()}>
              Test Connection
            </button>
            <button className="rounded-full border border-ink px-5 py-3 text-sm font-semibold text-ink" disabled={busy} type="button" onClick={() => void syncDevices()}>
              Sync Devices Now
            </button>
          </div>
          {message ? <p className="text-sm text-slate-700">{message}</p> : null}
        </form>
      </Panel>
      <Panel title="Access Model">
        <p className="text-slate-700">PiHomeHub uses a single admin account and private access through LAN or Tailscale. Tailscale tokens are write-only in the UI and are never displayed after saving.</p>
      </Panel>
      <Panel title="Deployment Notes">
        <p className="text-slate-700">Use Caddy or a similar reverse proxy for HTTPS termination. Keep the dashboard off the public internet.</p>
      </Panel>
    </div>
  );
}
