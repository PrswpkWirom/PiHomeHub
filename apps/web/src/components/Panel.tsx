export function Panel({
  title,
  children,
  action,
  description,
  className = ""
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <section className={`app-panel ${className}`}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="panel-title">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
