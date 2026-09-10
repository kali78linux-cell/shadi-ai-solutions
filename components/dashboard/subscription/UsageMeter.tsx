'use client';

// STEP 15G-A — Usage meter for the subscription dashboard.
// Shows the server-derived usage per canonical entitlement resource:
//   * numeric limit  -> used / limit + remaining + progress bar
//   * null (unlimited) -> "غير محدود" — never 0 and never a fallback value.

export type UsageMeterItem = {
  resource: string;
  labelAr: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  fromCatalog?: boolean;
};

function barTone(pct: number): string {
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-cyan-500';
}

export default function UsageMeter({ usage }: { usage: UsageMeterItem[] }) {
  if (!usage || usage.length === 0) {
    return <p className="text-sm text-slate-500">لا توجد بيانات استهلاك لعرضها.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {usage.map((item) => {
        const pct = item.limit && item.limit > 0 ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 0;
        return (
          <div key={item.resource} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-200">{item.labelAr}</span>
              {item.unlimited ? (
                <span className="text-sm font-semibold text-emerald-300">غير محدود</span>
              ) : (
                <span className="text-sm font-semibold text-slate-100">
                  {item.used} / {item.limit}
                </span>
              )}
            </div>
            {!item.unlimited && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${barTone(pct)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">المتبقي: {item.remaining} هذه الفترة</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}