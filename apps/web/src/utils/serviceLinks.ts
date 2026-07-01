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
