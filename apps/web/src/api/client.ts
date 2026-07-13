let csrfToken: string | null = null;

function csrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("pihomehub_csrf=") || item.startsWith("__Host-pihomehub_csrf="));
  return cookie ? decodeURIComponent(cookie.split("=", 2)[1]) : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  csrfToken ??= csrfTokenFromCookie();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers
  });

  const nextCsrfToken = response.headers.get("X-CSRF-Token");
  if (nextCsrfToken) {
    csrfToken = nextCsrfToken;
  }

  if (!response.ok) {
    const body = await response.text();
    let message = body;

    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
        if (response.status === 403 && parsed.detail === "Recent authentication required") {
          window.dispatchEvent(new CustomEvent("pihomehub:recent-auth-required"));
        }
      }
    } catch {
      // Keep the raw response body when the server does not return JSON.
    }

    throw new Error(message || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: "DELETE" })
};
