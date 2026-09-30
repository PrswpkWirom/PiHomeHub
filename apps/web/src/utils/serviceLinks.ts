import type { ServiceLink, ServiceStatus } from "../types/api";

const LOCAL_SERVICE_HOSTS = new Set(["pi.local", "localhost", "127.0.0.1", "0.0.0.0"]);

export function resolveServiceLinkUrl(url: string, currentLocation: Location = window.location) {
  try {
    const parsed = new URL(url, currentLocation.href);
    if (LOCAL_SERVICE_HOSTS.has(parsed.hostname) && currentLocation.hostname) {
      parsed.hostname = currentLocation.hostname;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function dashboardLinks(saved: ServiceLink[] | null, services: ServiceStatus[] | null): ServiceLink[] {
  const bySlug = new Map((saved ?? []).map((link) => [link.slug, link]));
  for (const [index, service] of (services ?? []).entries()) {
    if (service.status !== "running" || !service.url) continue;
    if (bySlug.get(service.slug)?.url_override) continue;
    bySlug.set(service.slug, {
      id: -index - 1,
      name: service.name,
      slug: service.slug,
      url: service.url,
      description: "Running service dashboard"
    });
  }
  return [...bySlug.values()].sort((left, right) => left.name.localeCompare(right.name));
}

// Explicitly saved URLs must retain their exact host, scheme, port, and path.
export function serviceLinkHref(link: ServiceLink) {
  return link.url_override ? link.url : resolveServiceLinkUrl(link.url);
}
