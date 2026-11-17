export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="brand-mark" aria-hidden="true">
        <svg width={compact ? 18 : 20} height={compact ? 18 : 20} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path className="brand-mark__outline" d="M8 21.5 24 8l16 13.5v17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="4.2" strokeLinejoin="round" />
          <path className="brand-mark__branches" d="M24 28v4m0 0-7 4m7-4 7 4" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle className="brand-mark__node" cx="24" cy="25" r="3.2" fill="currentColor" />
          <circle className="brand-mark__node" cx="17" cy="36" r="2.1" fill="currentColor" />
          <circle className="brand-mark__node" cx="31" cy="36" r="2.1" fill="currentColor" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className={`brand-name ${compact ? "text-lg" : "text-xl"}`}>PiHomeHub<span className="brand-period">.</span></p>
        {!compact ? <p className="brand-caption">A place for your home server</p> : null}
      </div>
    </div>
  );
}
