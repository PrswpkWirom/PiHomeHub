export function Panel({
  title,
  children,
  action
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
