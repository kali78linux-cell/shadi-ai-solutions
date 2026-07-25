import type { ReactNode } from 'react';

type DashboardSectionProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

export default function DashboardSection({ title, subtitle, action, className, children }: DashboardSectionProps) {
  return (
    <section className={`rounded-[2rem] border border-slate-800 bg-slate-900/85 p-6 shadow-xl shadow-slate-950/25 ${className ?? ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}
