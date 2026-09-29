let csrfToken: string | null = null;
let authRequestGeneration = 0;

export type SafeValidationError = {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly validationErrors: SafeValidationError[] = []
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class StaleRequestError extends Error {
  constructor() {
    super("This response belongs to an earlier sign-in session.");
    this.name = "StaleRequestError";
  }
}

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

function signal(name: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name));
  }
}

function safeValidationErrors(value: unknown): SafeValidationError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((error): SafeValidationError[] => {
    if (!error || typeof error !== "object") return [];
    const candidate = error as Record<string, unknown>;
    const loc = Array.isArray(candidate.loc)
      ? candidate.loc.filter((part): part is string | number => typeof part === "string" || typeof part === "number")
      : undefined;
    return [{
      loc,
      msg: typeof candidate.msg === "string" ? candidate.msg : "Invalid value",
      type: typeof candidate.type === "string" ? candidate.type : undefined
    }];
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const generation = authRequestGeneration;
  const method = (init?.method ?? "GET").toUpperCase();
  csrfToken ??= csrfTokenFromCookie();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, { ...init, credentials: "include", headers });
  if (generation !== authRequestGeneration) throw new StaleRequestError();

  const nextCsrfToken = response.headers.get("X-CSRF-Token");
  if (nextCsrfToken) csrfToken = nextCsrfToken;

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let validationErrors: SafeValidationError[] = [];
    let body: { detail?: unknown } | null = null;
    try {
      body = await response.json() as { detail?: unknown };
    } catch {
      // Do not show raw response bodies; they may contain submitted form values.
    }
    if (generation !== authRequestGeneration) throw new StaleRequestError();
    if (body) {
      if (typeof body.detail === "string") {
        message = body.detail;
        if (response.status === 403 && body.detail === "Recent authentication required") {
          signal("pihomehub:recent-auth-required");
        }
        if (response.status === 401 && ["Not authenticated", "Invalid or expired session", "Invalid session"].includes(body.detail)) {
          signal("pihomehub:session-invalid");
        }
        if (response.status === 403 && body.detail === "Invalid CSRF token") {
          message = "This request could not be verified. Refresh PiHomeHub and try again.";
        }
      } else if (Array.isArray(body.detail)) {
        validationErrors = safeValidationErrors(body.detail);
        message = validationErrors.map((error) => {
          const field = error.loc?.filter((part) => part !== "body").join(" ");
          return field ? `${field}: ${error.msg}` : error.msg ?? "Invalid value";
        }).join(" ") || message;
      }
    }
    throw new ApiError(message, response.status, validationErrors);
  }

  if (response.status === 204) return undefined as T;
  const body = await response.json() as T;
  if (generation !== authRequestGeneration) throw new StaleRequestError();
  return body;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export function resetAuthRequestGeneration() {
  authRequestGeneration += 1;
  csrfToken = null;
}

export function advanceAuthRequestGeneration() {
  authRequestGeneration += 1;
}

export function getAuthRequestGeneration() {
  return authRequestGeneration;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: "DELETE" })
};
