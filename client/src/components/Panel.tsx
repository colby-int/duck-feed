import type { ReactNode } from 'react';

export function Panel({
  title,
  subtitle,
  children,
  action,
}: {
  title: ReactNode;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="bg-cobalt p-2 shadow-[0_0_0_1px_rgba(20,20,19,0.12)]">
      <div className="bg-card px-5 py-5 text-ink">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            {subtitle ? (
              <div className="text-[0.68rem] uppercase tracking-[0.26em] text-cobalt/90">{subtitle}</div>
            ) : null}
            <h2 className="mt-2 text-[1.85rem] font-medium leading-tight text-ink">{title}</h2>
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}
