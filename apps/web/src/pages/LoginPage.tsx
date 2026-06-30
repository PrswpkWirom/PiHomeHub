import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, Router } from "lucide-react";

import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-dvh overflow-x-hidden bg-app px-4 py-8 text-mist sm:place-items-center">
      <form className="app-panel w-full min-w-0 max-w-[20.5rem] self-start justify-self-start sm:mx-auto sm:max-w-md sm:self-auto sm:justify-self-center" onSubmit={onSubmit}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
            <Router size={24} />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">LAN and Tailscale</p>
            <h1 className="font-display text-3xl font-semibold leading-tight text-white">PiHomeHub</h1>
          </div>
        </div>
        <p className="mt-4 break-words text-sm leading-6 text-muted">Single-admin access for your private home dashboard.</p>
        <label className="field-label mt-6">
          Username
          <input className="input-field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="field-label mt-4">
          Password
          <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error ? <p className="error-callout mt-4">{error}</p> : null}
        <button className="btn-primary mt-6 w-full" disabled={submitting}>
          <LockKeyhole size={17} />
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
