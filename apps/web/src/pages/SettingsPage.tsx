import { Panel } from "../components/Panel";

export function SettingsPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Access Model">
        <p className="text-slate-700">PiHomeHub v0.1 assumes a single local admin account and private access through LAN or Tailscale.</p>
      </Panel>
      <Panel title="Deployment Notes">
        <p className="text-slate-700">Use Caddy or a similar reverse proxy for HTTPS termination. Keep the dashboard off the public internet.</p>
      </Panel>
    </div>
  );
}
