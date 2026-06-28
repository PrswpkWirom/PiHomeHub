import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { ServiceLink, ServiceStatus } from "../types/api";

export function ServicesPage() {
  const statuses = useFetch<ServiceStatus[]>("/api/services/status");
  const links = useFetch<ServiceLink[]>("/api/services/links");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Monitored Services">
        <div className="space-y-4">
          {statuses.data?.map((service) => (
            <div key={service.slug} className="flex items-center justify-between rounded-3xl bg-clay p-4">
              <div>
                <p className="font-semibold text-ink">{service.name}</p>
                <p className="text-sm text-slate-500">{service.detail}</p>
              </div>
              <StatusPill status={service.status} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Dashboards">
        <div className="space-y-4">
          {links.data?.map((link) => (
            <a key={link.slug} href={link.url} className="block rounded-3xl bg-clay p-4">
              <p className="font-semibold text-ink">{link.name}</p>
              <p className="text-sm text-slate-500">{link.description ?? link.url}</p>
            </a>
          ))}
        </div>
      </Panel>
    </div>
  );
}
