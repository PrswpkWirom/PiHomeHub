import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole, ShieldCheck, Wifi } from "lucide-react";

import { BrandMark } from "../components/BrandMark";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const { user, login, authNotice, authError, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locationNotice = (location.state as { notice?: unknown } | null)?.notice;
  const notice = typeof locationNotice === "string" ? locationNotice : authNotice;

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [navigate, user]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError(null);
    try { await login(username, password); navigate("/dashboard"); }
    catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <main className="relative grid min-h-dvh bg-app text-mist lg:grid-cols-[1.08fr_.92fr]">
      <section className="login-visual">
        <div className="login-visual__texture" aria-hidden="true" />
        <div className="login-visual__content">
          <div className="login-visual__label"><span /> Local-first home intelligence</div>
          <h1>Your private home.<br /><span>Under your control.</span></h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/60">Monitor devices, manage services, and keep your home running—without exposing it to the public internet.</p>
          <div className="login-visual__facts"><span><ShieldCheck size={17} /> Private by design</span><span><Wifi size={17} /> LAN + Tailscale</span></div>
        </div>
      </section>

      <section className="relative grid min-h-dvh place-items-center px-5 py-10 sm:px-10">
        <div className="absolute right-5 top-5"><ThemeToggle compact /></div>
        <form className="w-full max-w-[27rem]" onSubmit={onSubmit}>
          <BrandMark />
          <div className="mt-12">
            <p className="eyebrow"><span /> Secure access</p>
            <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-.05em] text-mist">Welcome home.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Sign in to open your private command center.</p>
          </div>
          <div className="mt-8 grid gap-4">
            <label className="field-label">Username<input className="input-field" value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }} autoComplete="username" /></label>
            <label className="field-label">Password<input className="input-field" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} autoComplete="current-password" /></label>
          </div>
          <FeedbackMessage className="mt-4" feedback={notice ? { kind: "success", text: notice } : null} />
          <FeedbackMessage className="mt-4" feedback={authError ? { kind: "error", persistent: true, text: authError } : null} action={<button className="btn-secondary" type="button" onClick={() => void refresh()}>Retry session check</button>} />
          <FeedbackMessage className="mt-4" feedback={error ? { kind: "error", persistent: true, text: error } : null} />
          <button className="btn-primary mt-6 w-full" disabled={submitting}>
            {submitting ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Signing in…</> : <><LockKeyhole size={17} /> Enter PiHomeHub <ArrowRight size={16} /></>}
          </button>
          <p className="mt-6 text-center text-xs leading-5 text-muted">Only available on your trusted local or Tailscale network.</p>
        </form>
      </section>
    </main>
  );
}
