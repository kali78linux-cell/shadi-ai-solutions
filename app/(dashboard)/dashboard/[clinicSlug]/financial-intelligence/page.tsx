'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * PP-5 — Financial Intelligence (clinic-facing, read-only).
 * Renders derived KPIs + trends + anomalies + informational recommendations.
 * No actions are ever executed from this UI.
 */

type Kpis = {
  revenue: number;
  collected: number;
  outstanding: number;
  refunds: number;
  expenses: number;
  netPosition: number;
  netCash: number;
  collectionRate: number | null;
  netMargin: number | null;
  expenseRatio: number | null;
  refundRatio: number | null;
  overdue90Share: number | null;
};

type Anomaly = {
  kind: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
  month: string | null;
  detail: string;
};

type Recommendation = {
  code: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
};

type Bucket = { bucket: string; invoices: number; balance: number; shareOfOutstanding: number | null };
type MethodSplit = { method: string; inflows: number; shareOfCollected: number | null };

type Report = {
  kpis: Kpis;
  pnlTrends: { month: string; revenue: number; net: number }[];
  receivables: { buckets: Bucket[]; paymentMethods: MethodSplit[] };
  anomalies: Anomaly[];
  recommendations: Recommendation[];
};

const PERIOD_OPTIONS = [
  { label: '٣ أشهر', months: 3 },
  { label: '٦ أشهر', months: 6 },
  { label: '١٢ شهرًا', months: 12 },
];

function monthRange(months: number): { fromMonth: string; toMonth: string } {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - (months - 1), 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return { fromMonth: fmt(from), toMonth: fmt(to) };
}

const fmtMoney = (n: number | null | undefined): string =>
  n == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(Number(n));
const fmtPct = (n: number | null | undefined): string => (n == null ? '—' : `${fmtMoney(n)}%`);

const severityTone: Record<string, string> = {
  high: 'border-red-500/50 bg-red-500/10 text-red-200',
  medium: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  low: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
};
const severityLabel: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

export default function FinancialIntelligencePage() {
  const { clinicId, authHeaders } = useClinicContext();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(6);

  useEffect(() => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    let isMounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const range = monthRange(months);
        const url = `/api/clinic/financial-intelligence?clinic_id=${encodeURIComponent(clinicId as string)}&from_month=${range.fromMonth}&to_month=${range.toMonth}`;
        const response = await fetch(url, { headers: await authHeaders() });
        if (!response.ok) {
          if (response.status === 403) throw new Error('لا تملك صلاحية الوصول للمؤشرات المالية');
          throw new Error('خدمة الذكاء المالي غير متاحة');
        }
        const payload = await response.json();
        if (isMounted) setData(payload?.data ?? null);
      } catch (caughtError) {
        if (isMounted) setError(caughtError instanceof Error ? caughtError.message : 'حدث خطأ غير معروف');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [clinicId, authHeaders, months]);

  const kpis = data?.kpis;
  const kpiCards = useMemo(() => {
    if (!kpis) return [];
    return [
      { label: 'الإيرادات', value: fmtMoney(kpis.revenue) },
      { label: 'المحصَّل', value: fmtMoney(kpis.collected) },
      { label: 'المستحق', value: fmtMoney(kpis.outstanding) },
      { label: 'الاستردادات', value: fmtMoney(kpis.refunds) },
      { label: 'المصروفات', value: fmtMoney(kpis.expenses) },
      { label: 'صافي النتيجة', value: fmtMoney(kpis.netPosition) },
      { label: 'صافي النقد', value: fmtMoney(kpis.netCash) },
      { label: 'نسبة التحصيل', value: fmtPct(kpis.collectionRate) },
      { label: 'هامش الربح', value: fmtPct(kpis.netMargin) },
      { label: 'نسبة المصروفات', value: fmtPct(kpis.expenseRatio) },
      { label: 'نسبة الاستردادات', value: fmtPct(kpis.refundRatio) },
      { label: 'متأخرات 90+', value: fmtPct(kpis.overdue90Share) },
    ];
  }, [kpis]);

  // P0-D — honest empty state: a clinic with zero invoices/payments/expenses
  // and no trends shows a clear message instead of a grid of misleading zeros.
  const isEmptyFinancial = useMemo(() => {
    if (!data || !kpis) return false;
    const allZero =
      kpis.revenue === 0 &&
      kpis.collected === 0 &&
      kpis.outstanding === 0 &&
      kpis.refunds === 0 &&
      kpis.expenses === 0 &&
      kpis.netPosition === 0 &&
      kpis.netCash === 0;
    return allZero && data.pnlTrends.length === 0 && data.receivables.buckets.every((b) => b.invoices === 0 && b.balance === 0);
  }, [data, kpis]);

  return (
    <div className="space-y-6">
      <DashboardSection
        title="الذكاء المالي"
        subtitle="مؤشرات واتجاهات وتحذيرات مالية مشتقة من سجلات العيادة (قراءة فقط — لا إجراءات تلقائية)."
        action={
          <div className="flex gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.months}
                type="button"
                onClick={() => setMonths(option.months)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  months === option.months
                    ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {!clinicId ? (
          <EmptyState title="لا توجد عيادة محددة" description="اختر عيادة من القائمة لعرض مؤشراتها المالية." />
        ) : loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : error ? (
          <EmptyState title="خدمة الذكاء المالي غير متاحة" description={error} />
        ) : data && kpis && isEmptyFinancial ? (
          <EmptyState
            title="لا توجد بيانات مالية بعد"
            description="ستظهر المؤشرات والاتجاهات هنا عند تسجيل أول فاتورة أو دفعة أو مصروف في عيادتك."
          />
        ) : data && kpis ? (
          <div className="space-y-8">
            {/* KPIs */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpiCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <p className="text-xs text-slate-400">{card.label}</p>
                  <p className="mt-1 text-xl font-semibold text-cyan-200">{card.value}</p>
                </div>
              ))}
            </div>
            <PP5InsightBlocks data={data} />
          </div>
        ) : null}
      </DashboardSection>
    </div>
  );
}

function PP5InsightBlocks({ data }: { data: Report }) {
  return (
    <>
      {/* Recommendations (informational) */}
      {data.recommendations.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">توصيات مقترحة</h3>
          <ul className="space-y-2">
            {data.recommendations.map((r) => (
              <li key={r.code} className="flex items-start gap-2 text-sm text-slate-200">
                <span className={`mt-0.5 rounded-full border px-2 py-0.5 text-[10px] ${severityTone[r.severity]}`}>
                  {severityLabel[r.severity]}
                </span>
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">التوصيات إرشادية فقط — لا تُنفَّذ أي إجراء تلقائي.</p>
        </div>
      )}

      {/* Anomalies */}
      {data.anomalies.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">تحذيرات (قواعد موثقة)</h3>
          <ul className="space-y-2">
            {data.anomalies.map((a, idx) => (
              <li key={`${a.kind}-${a.month ?? 'all'}-${idx}`} className="flex items-start gap-2 text-sm text-slate-200">
                <span className={`mt-0.5 rounded-full border px-2 py-0.5 text-[10px] ${severityTone[a.severity]}`}>
                  {severityLabel[a.severity]}
                </span>
                <span>
                  <span className="font-medium text-slate-100">{a.label}</span>
                  {a.month ? ` (${a.month})` : ''}
                  <span className="text-slate-400"> — {a.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PP5Receivables data={data} />
    </>
  );
}

function PP5Receivables({ data }: { data: Report }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">توزيع المستحقات</h3>
        <div className="space-y-2">
          {data.receivables.buckets.map((b) => (
            <div key={b.bucket} className="flex items-center justify-between text-sm">
              <span className="text-slate-300">
                {b.bucket === 'current' ? 'حالي' : b.bucket} ({b.invoices} فاتورة)
              </span>
              <span className="text-slate-200">
                {fmtMoney(b.balance)} · {fmtPct(b.shareOfOutstanding)}
              </span>
            </div>
          ))}
        </div>
        {data.receivables.paymentMethods.length > 0 && (
          <>
            <h4 className="mb-2 mt-4 text-xs font-semibold text-slate-400">توزيع طرق الدفع</h4>
            <div className="space-y-1">
              {data.receivables.paymentMethods.map((m) => (
                <div key={m.method} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{m.method}</span>
                  <span className="text-slate-200">
                    {fmtMoney(m.inflows)} · {fmtPct(m.shareOfCollected)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">اتجاه الإيرادات والصافي</h3>
        {data.pnlTrends.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد بيانات في هذه الفترة.</p>
        ) : (
          <ul className="space-y-2">
            {data.pnlTrends.map((t) => (
              <li key={t.month} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{t.month}</span>
                <span className="text-slate-200">
                  إيراد {fmtMoney(t.revenue)} · صافي {fmtMoney(t.net)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}