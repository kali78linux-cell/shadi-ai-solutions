import type { ReactNode } from 'react';

type MetricCardProps = {
  title: string;
  value: string;
  detail?: string;
  tone?: 'cyan' | 'emerald' | 'violet' | 'amber';
  icon?: ReactNode;
};

const toneMap = {
  cyan: 'from-cyan-500/20 to-sky-500/5 text-cyan-200 border-cyan-500/20',
  emerald: 'from-emerald-500/20 to-lime-500/5 text-emerald-200 border-emerald-500/20',
  violet: 'from-violet-500/20 to-fuchsia-500/5 text-violet-200 border-violet-500/20',
  amber: 'from-amber-500/20 to-orange-500/5 text-amber-200 border-amber-500/20',
};

export default function MetricCard({ title, value, detail, tone = 'cyan', icon }: MetricCardProps) {
  return (
    <div className={`rounded-[1.75rem] border bg-gradient-to-br p-5 shadow-lg shadow-slate-950/20 ${toneMap[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-300">{title}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
          {detail ? <p className="mt-2 text-sm text-slate-400">{detail}</p> : null}
        </div>
        {icon ? <div className="rounded-2xl bg-slate-950/60 p-3">{icon}</div> : null}
      </div>
    </div>
  );
}
