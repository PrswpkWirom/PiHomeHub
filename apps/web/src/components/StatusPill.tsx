export function StatusPill({ status }: { status: string }) {
  const palette =
    status === "online" || status === "running"
      ? "bg-emerald-100 text-emerald-800"
      : status === "offline" || status === "exited"
        ? "bg-amber-100 text-amber-900"
        : "bg-slate-200 text-slate-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${palette}`}>{status}</span>;
}
