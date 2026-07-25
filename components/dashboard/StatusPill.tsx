type StatusPillProps = {
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  children: string;
};

const toneStyles = {
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  danger: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export default function StatusPill({ tone = 'neutral', children }: StatusPillProps) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${toneStyles[tone]}`}>{children}</span>;
}
