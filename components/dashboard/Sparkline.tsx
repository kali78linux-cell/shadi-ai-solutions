type SparklineProps = {
  values: number[];
};

export default function Sparkline({ values }: SparklineProps) {
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (value / max) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="h-24 w-full overflow-hidden rounded-[1.25rem] border border-slate-800 bg-slate-950/70 p-3">
      <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-gradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <polyline fill="none" stroke="url(#spark-gradient)" strokeWidth="4" points={points} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
