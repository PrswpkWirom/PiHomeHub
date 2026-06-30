export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const palette =
    normalized === "online" || normalized === "running" || normalized === "active" || normalized === "connected"
      ? "border-success/30 bg-success/10 text-success before:bg-success"
      : normalized === "offline" || normalized === "exited" || normalized === "not connected"
        ? "border-warning/35 bg-warning/10 text-warning before:bg-warning"
        : normalized === "error" || normalized === "failed" || normalized === "unhealthy"
          ? "border-danger/35 bg-danger/10 text-danger before:bg-danger"
          : "border-line bg-white/[0.04] text-muted before:bg-muted";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold capitalize before:h-1.5 before:w-1.5 before:rounded-full ${palette}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
