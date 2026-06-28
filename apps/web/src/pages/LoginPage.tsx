import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

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
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,_#14213d_0%,_#1f4f58_45%,_#58735c_100%)] px-4">
      <form className="w-full max-w-md rounded-[2rem] bg-white/90 p-8 shadow-panel" onSubmit={onSubmit}>
        <p className="text-xs uppercase tracking-[0.3em] text-ember">LAN and Tailscale only</p>
        <h1 className="mt-3 font-display text-4xl text-ink">PiHomeHub</h1>
        <p className="mt-2 text-sm text-slate-600">Single-admin access for your private home dashboard.</p>
        <label className="mt-6 block text-sm font-semibold text-ink">
          Username
          <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="mt-4 block text-sm font-semibold text-ink">
          Password
          <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
        <button className="mt-6 w-full rounded-full bg-ink px-4 py-3 font-semibold text-white" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
