import { Router } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="brand-mark" aria-hidden="true">
        <span className="brand-mark__pulse" />
        <Router size={compact ? 18 : 20} strokeWidth={2.15} />
      </div>
      <div className="min-w-0">
        <p className="brand-kicker"><span /> Private network</p>
        <p className={`brand-name ${compact ? "text-lg" : "text-xl"}`}>PiHomeHub</p>
      </div>
    </div>
  );
}
