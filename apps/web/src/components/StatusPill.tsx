export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const palette =
    normalized === "online" || normalized === "running" || normalized === "active" || normalized === "connected"
      ? "border-success/35 bg-success/10 text-success before:bg-success"
      : normalized === "offline" || normalized === "exited" || normalized === "not connected"
        ? "border-warning/40 bg-warning/10 text-warning before:bg-warning"
        : normalized === "error" || normalized === "failed" || normalized === "unhealthy"
          ? "border-danger/40 bg-danger/10 text-danger before:bg-danger"
          : "border-line bg-deep text-muted before:bg-muted";

  return (
    <span
      className={`inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize before:h-1.5 before:w-1.5 before:rounded-full ${palette}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
