import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { useFetch } from "../hooks/useFetch";
import type { ServiceLink, ServiceStatus } from "../types/api";

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

export function ServicesPage() {
  const statuses = useFetch<ServiceStatus[]>("/api/services/status");
  const links = useFetch<ServiceLink[]>("/api/services/links");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Monitored Services">
        <div className="space-y-4">
          {statuses.data?.map((service) => {
            const info = SERVICE_INFO[service.slug];

            return (
              <div key={service.slug} className="rounded-3xl bg-clay p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-ink">{service.name}</p>
                    <p className="text-sm text-slate-500">{service.detail}</p>
                  </div>
                  <StatusPill status={service.status} />
                </div>
                {info ? (
                  <details className="group mt-3 border-t border-white/70 pt-3">
                    <summary className="cursor-pointer list-none text-sm font-semibold text-moss outline-none transition hover:text-ink focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-moss/40">
                      <span className="group-open:hidden">More info</span>
                      <span className="hidden group-open:inline">Hide info</span>
                    </summary>
                    <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                      <p>{info.summary}</p>
                      <p>{info.useCase}</p>
                      <div className="flex flex-wrap gap-2">
                        {info.links.map((link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-moss/30 px-3 py-1 font-semibold text-moss transition hover:border-moss hover:bg-white/60"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
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
