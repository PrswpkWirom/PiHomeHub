import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { DeviceSummary } from "../types/api";

export function DevicesPage() {
  const { data, loading, error } = useFetch<DeviceSummary[]>("/api/devices");

  return (
    <Panel title="Devices">
      {loading ? <p>Loading devices…</p> : null}
      {error ? <p className="text-red-700">{error}</p> : null}
      <div className="space-y-4">
        {data?.map((device) => (
          <div key={`${device.name}-${device.id ?? "local"}`} className="grid gap-2 rounded-3xl bg-clay p-5 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:items-center">
            <div>
              <p className="font-semibold text-ink">{device.name}</p>
              <p className="text-sm text-slate-600">{device.device_type}</p>
            </div>
            <div className="text-sm text-slate-600">
              <p>{device.ip_address ?? "No IP configured"}</p>
              <p>{device.tailscale_name ?? "No Tailscale host"}</p>
            </div>
            <div className="flex justify-start md:justify-end">
              <StatusPill status={device.status} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
