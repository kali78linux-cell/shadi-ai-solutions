type StatCardProps = {
  label: string;
  value: string;
  description?: string;
};

export default function StatCard({ label, value, description }: StatCardProps) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
      <p className="text-sm uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
      {description ? <p className="mt-2 text-sm text-slate-400">{description}</p> : null}
    </div>
  );
}
