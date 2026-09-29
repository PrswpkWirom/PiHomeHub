import { FormEvent, createContext, useContext, useEffect, useRef, useState } from "react";

import { advanceAuthRequestGeneration, ApiError, api, getAuthRequestGeneration, resetAuthRequestGeneration } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { clearApiCache, invalidateCache } from "../hooks/useFetch";
import type { AuthUser } from "../types/api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
  endSession: (notice?: string) => void;
  authNotice: string | null;
  authError: string | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthenticating, setReauthenticating] = useState(false);
  const reauthDialog = useRef<HTMLFormElement>(null);
  const backgroundContent = useRef<HTMLDivElement>(null);

  const endSession = (notice?: string) => {
    resetAuthRequestGeneration();
    clearApiCache();
    setUser(null);
    setLoading(false);
    setAuthNotice(notice ?? null);
    setAuthError(null);
    setReauthRequired(false);
    setReauthPassword("");
    setReauthError(null);
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_AUTH_CACHES" });
  };

  const closeReauthentication = () => {
    if (reauthenticating) return;
    setReauthRequired(false);
    setReauthPassword("");
    setReauthError(null);
  };

  const refresh = async () => {
    const generation = getAuthRequestGeneration();
    setAuthError(null);
    if (!user) setLoading(true);
    try {
      const nextUser = await api.get<AuthUser>("/api/auth/me");
      if (generation !== getAuthRequestGeneration()) return;
      setUser(nextUser);
      setAuthNotice(null);
    } catch (error) {
      if (generation !== getAuthRequestGeneration()) return;
      if (error instanceof ApiError && error.status === 401) {
        endSession("Your session ended. Sign in again.");
      } else {
        setAuthError("PiHomeHub could not verify the sign-in session. Check the connection and retry.");
      }
    } finally {
      if (generation === getAuthRequestGeneration()) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!reauthRequired) {
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backgroundContent.current?.setAttribute("inert", "");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReauthentication();
        return;
      }
      if (event.key !== "Tab" || !reauthDialog.current) {
        return;
      }
      const focusable = Array.from(
        reauthDialog.current.querySelectorAll<HTMLElement>("input, button:not([disabled])")
      );
      if (!focusable.length) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      backgroundContent.current?.removeAttribute("inert");
      previousFocus?.focus();
    };
  }, [reauthRequired]);

  useEffect(() => {
    const requireRecentAuthentication = () => setReauthRequired(true);
    const sessionInvalid = () => endSession("Your session ended. Sign in again.");
    window.addEventListener("pihomehub:recent-auth-required", requireRecentAuthentication);
    window.addEventListener("pihomehub:session-invalid", sessionInvalid);
    return () => {
      window.removeEventListener("pihomehub:recent-auth-required", requireRecentAuthentication);
      window.removeEventListener("pihomehub:session-invalid", sessionInvalid);
    };
  }, []);

  const login = async (username: string, password: string) => {
    resetAuthRequestGeneration();
    clearApiCache();
    setAuthNotice(null);
    setAuthError(null);
    const nextUser = await api.post<AuthUser>("/api/auth/login", { username, password });
    setUser(nextUser);
  };

  const logout = async () => {
    await api.post("/api/auth/logout");
    endSession("You have signed out.");
  };

  const reauthenticate = async (password: string) => {
    await api.post("/api/auth/reauthenticate", { password });
    advanceAuthRequestGeneration();
    invalidateCache("/api/auth/sessions");
  };

  const submitReauthentication = async (event: FormEvent) => {
    event.preventDefault();
    setReauthenticating(true);
    setReauthError(null);
    try {
      await reauthenticate(reauthPassword);
      closeReauthentication();
    } catch (error) {
      setReauthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setReauthenticating(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, reauthenticate, endSession, authNotice, authError }}>
      <div ref={backgroundContent} className="contents" aria-hidden={reauthRequired || undefined}>
        {children}
      </div>
      {reauthRequired ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation">
          <form
            ref={reauthDialog}
            className="panel w-full max-w-md space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reauth-title"
            onSubmit={submitReauthentication}
          >
            <div>
              <h2 id="reauth-title" className="text-xl font-semibold text-mist">Confirm it’s you</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Enter your password to continue with this sensitive action. Retry it after confirmation.
              </p>
            </div>
            <label className="field-label">
              Password
              <input
                className="input-field"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={reauthPassword}
                onChange={(event) => { setReauthPassword(event.target.value); setReauthError(null); }}
              />
            </label>
            <FeedbackMessage feedback={reauthError ? { kind: "error", persistent: true, text: reauthError } : null} />
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" type="button" onClick={closeReauthentication}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={reauthenticating}>
                {reauthenticating ? "Confirming..." : "Confirm"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
