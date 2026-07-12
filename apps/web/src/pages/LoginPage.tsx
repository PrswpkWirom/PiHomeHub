import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole, ShieldCheck, Wifi } from "lucide-react";

import { BrandMark } from "../components/BrandMark";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError(null);
    try { await login(username, password); navigate("/dashboard"); }
    catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <main className="relative grid min-h-dvh bg-app text-mist lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative hidden min-h-dvh overflow-hidden bg-[#061411] lg:block">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/assets/pihomehub-hero.webp')" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-[#061411]/30 via-[#061411]/20 to-[#061411]/75" />
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#061411] to-transparent" />
        <div className="absolute inset-x-10 bottom-10 text-white xl:inset-x-16 xl:bottom-14">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold backdrop-blur"><span className="h-2 w-2 rounded-full bg-[#5be0bd] shadow-[0_0_12px_#5be0bd]" /> Local-first home intelligence</div>
          <h1 className="max-w-xl font-display text-5xl font-extrabold leading-[.98] tracking-[-.055em] xl:text-6xl">Your private home.<br /><span className="text-[#73e2c7]">Under your control.</span></h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/60">Monitor devices, manage services, and keep your home running—without exposing it to the public internet.</p>
          <div className="mt-8 flex gap-5 text-sm text-white/60"><span className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#73e2c7]" /> Private by design</span><span className="flex items-center gap-2"><Wifi size={17} className="text-[#73e2c7]" /> LAN + Tailscale</span></div>
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
            <label className="field-label">Username<input className="input-field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
            <label className="field-label">Password<input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          </div>
          {error ? <p className="error-callout mt-4" role="alert">{error}</p> : null}
          <button className="btn-primary mt-6 w-full" disabled={submitting}>
            {submitting ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Signing in…</> : <><LockKeyhole size={17} /> Enter PiHomeHub <ArrowRight size={16} /></>}
          </button>
          <p className="mt-6 text-center text-xs leading-5 text-muted">Only available on your trusted local or Tailscale network.</p>
        </form>
      </section>
    </main>
  );
}
