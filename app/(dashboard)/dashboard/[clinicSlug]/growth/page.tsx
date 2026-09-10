'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * PP-7 — Growth / Retention & Engagement (clinic-facing, read-only).
 * Renders derived retention/recall/no-show/engagement/waitlist insights and a
 * GUIDANCE-ONLY growth score. No actions are ever executed from this UI.
 */

type Retention = {
  totalPatients: number;
  newPatients: number;
  activePatients: number;
  returningPatients: number;
  reactivatedPatients: number;
  inactivePatients: number;
  completedInRange: number;
  retentionRate: number | null;
  avgVisitsPerActivePatient: number | null;
  avgDaysBetweenVisits: number | null;
};

type Recalls = {
  total: number;
  byStatus: { open: number; notified: number; scheduled: number; dismissed: number };
  overdue: number;
  conversionRate: number | null;
};

type NoShow = {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  noShowRate: number | null;
  cancellationRate: number | null;
  completionRate: number | null;
  repeatNoShowPatients: { patientId: string; count: number }[];
  monthly: { month: string; appointments: number; noShow: number; noShowRate: number | null }[];
};

type Engagement = {
  conversations: number;
  bookings: number;
  completed: number;
  conversationToBookingRate: number | null;
  monthly: { month: string; conversations: number; bookings: number }[];
};

type Waitlist = {
  total: number;
  byStatus: { active: number; notified: number; booked: number; expired: number; cancelled: number };
  offerConversionRate: number | null;
};

type GrowthScore = {
  score: number | null;
  basis: 'derived' | 'insufficient_data';
  components: { key: string; label: string; weight: number; value: number | null; effectiveWeight: number }[];
};

type Recommendation = { code: string; severity: 'high' | 'medium' | 'low'; message: string };

type Report = {
  range: { fromDate: string; toDate: string; historyFrom: string };
  retention: Retention;
  recalls: Recalls;
  noShow: NoShow;
  engagement: Engagement;
  waitlist: Waitlist;
  growthScore: GrowthScore;
  recommendations: Recommendation[];
};

const PERIOD_OPTIONS = [
  { label: '٣٠ يومًا', days: 30 },
  { label: '٩٠ يومًا', days: 90 },
  { label: '١٨٠ يومًا', days: 180 },
];

function dateRange(days: number): { fromDate: string; toDate: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { fromDate: fmt(from), toDate: fmt(to) };
}

const fmtNum = (n: number | null | undefined): string =>
  n == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(Number(n));
const fmtPct = (n: number | null | undefined): string => (n == null ? '—' : `${fmtNum(n)}%`);

const severityTone: Record<string, string> = {
  high: 'border-red-500/50 bg-red-500/10 text-red-200',
  medium: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  low: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
};


export default function GrowthPage() {
  const { clinicId, authHeaders } = useClinicContext();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);

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
        const range = dateRange(days);
        const url = `/api/clinic/growth-intelligence?clinic_id=${encodeURIComponent(clinicId as string)}&from_date=${range.fromDate}&to_date=${range.toDate}`;
        const response = await fetch(url, { headers: await authHeaders() });
        if (!response.ok) {
          if (response.status === 403) throw new Error('لا تملك صلاحية الوصول لمؤشرات النمو');
          throw new Error('خدمة النمو والاحتفاظ غير متاحة');
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
  }, [clinicId, authHeaders, days]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <EmptyState title="تعذر تحميل مؤشرات النمو" description={error} />;
  }

  if (!data) {
    return (
      <EmptyState
        title="لا توجد بيانات"
        description="لم يتم العثور على بيانات كافية لاشتقاق مؤشرات النمو لهذه العيادة."
      />
    );
  }

  const r = data.retention;
  const kpiCards = [
    { label: 'إجمالي المرضى', value: fmtNum(r.totalPatients) },
    { label: 'مرضى جدد', value: fmtNum(r.newPatients) },
    { label: 'مرضى نشطون', value: fmtNum(r.activePatients) },
    { label: 'مرضى عائدون', value: fmtNum(r.returningPatients) },
    { label: 'معدل الاحتفاظ', value: fmtPct(r.retentionRate) },
    { label: 'معاد تنشيطهم', value: fmtNum(r.reactivatedPatients) },
    { label: 'مرضى خاملون', value: fmtNum(r.inactivePatients) },
    { label: 'متوسط الزيارات للنشط', value: fmtNum(r.avgVisitsPerActivePatient) },
    { label: 'متوسط الأيام بين الزيارات', value: fmtNum(r.avgDaysBetweenVisits) },
  ];

  return (
    <div className="space-y-6">
      <DashboardSection
        title="النمو والاحتفاظ"
        subtitle="مؤشرات نمو واحتفاظ وتفاعل مشتقة من سجلات العيادة (قراءة فقط — لا إجراءات تلقائية)."
        action={
          <div className="flex gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                onClick={() => setDays(option.days)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  days === option.days
                    ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {kpiCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs text-slate-400">{card.label}</p>
              <p className="mt-1 text-lg font-semibold text-white">{card.value}</p>
            </div>
          ))}
        </div>
      </DashboardSection>

      <GrowthScoreCard data={data} />
      <RecallsAndNoShow data={data} />
      <EngagementAndWaitlist data={data} />
      <RecommendationsCard data={data} />
    </div>
  );
}

function GrowthScoreCard({ data }: { data: Report }) {
  const gs = data.growthScore;
  return (
    <DashboardSection
      title="مؤشر النمو (إرشادي)"
      subtitle="درجة مركبة مشتقة من بيانات الفترة — إرشادية فقط وليست حكمًا طبيًا أو ماليًا."
    >
      {gs.score == null ? (
        <p className="text-sm text-slate-500">
          لا تتوفر بيانات كافية لاشتقاق الدرجة لهذه الفترة (لا تُخمَّن أي قيم).
        </p>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-6 py-4 text-center">
            <p className="text-3xl font-bold text-cyan-200">{gs.score}</p>
            <p className="text-xs text-slate-400">من 100</p>
          </div>
          <div className="flex-1 space-y-2">
            {gs.components.map((c) => (
              <div key={c.key} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">
                  {c.label} <span className="text-xs text-slate-500">(وزن {c.weight})</span>
                </span>
                <span className={c.value == null ? 'text-slate-500' : 'text-slate-100'}>
                  {c.value == null ? 'بيانات غير كافية' : `${fmtNum(c.value)} · وزن فعّال ${c.effectiveWeight}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardSection>
  );
}

function RecallsAndNoShow({ data }: { data: Report }) {
  const rec = data.recalls;
  const ns = data.noShow;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">أداء الاستدعاءات (Recall)</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-300">إجمالي الاستدعاءات</span><span className="text-slate-100">{fmtNum(rec.total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">مفتوحة</span><span className="text-slate-100">{fmtNum(rec.byStatus.open)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">تم إشعارها</span><span className="text-slate-100">{fmtNum(rec.byStatus.notified)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">تم الجدولة</span><span className="text-slate-100">{fmtNum(rec.byStatus.scheduled)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">مرفوضة</span><span className="text-slate-100">{fmtNum(rec.byStatus.dismissed)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">متأخرة (انقضى موعدها)</span><span className="text-red-300">{fmtNum(rec.overdue)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نسبة التحويل</span><span className="text-slate-100">{fmtPct(rec.conversionRate)}</span></div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">ذكاء عدم الحضور (No-show)</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-300">مواعيد الفترة</span><span className="text-slate-100">{fmtNum(ns.total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نسبة عدم الحضور</span><span className="text-amber-300">{fmtPct(ns.noShowRate)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نسبة الإلغاء</span><span className="text-slate-100">{fmtPct(ns.cancellationRate)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نسبة الإتمام</span><span className="text-slate-100">{fmtPct(ns.completionRate)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">مرضى بعدم حضور متكرر</span><span className="text-amber-300">{fmtNum(ns.repeatNoShowPatients.length)}</span></div>
        </div>
        {ns.monthly.length > 0 && (
          <>
            <h4 className="mb-2 mt-4 text-xs font-semibold text-slate-400">عدم الحضور شهريًا</h4>
            <ul className="space-y-1">
              {ns.monthly.map((m) => (
                <li key={m.month} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{m.month}</span>
                  <span className="text-slate-200">
                    {fmtNum(m.appointments)} موعدًا · {fmtNum(m.noShow)} غياب ({fmtPct(m.noShowRate)})
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function EngagementAndWaitlist({ data }: { data: Report }) {
  const en = data.engagement;
  const wl = data.waitlist;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">التفاعل (محادثات → حجوزات)</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-300">محادثات الفترة</span><span className="text-slate-100">{fmtNum(en.conversations)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">حجوزات الفترة</span><span className="text-slate-100">{fmtNum(en.bookings)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">مواعيد مكتملة</span><span className="text-slate-100">{fmtNum(en.completed)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نسبة التحويل</span><span className="text-slate-100">{fmtPct(en.conversationToBookingRate)}</span></div>
        </div>
        {en.monthly.length > 0 && (
          <>
            <h4 className="mb-2 mt-4 text-xs font-semibold text-slate-400">شهريًا</h4>
            <ul className="space-y-1">
              {en.monthly.map((m) => (
                <li key={m.month} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{m.month}</span>
                  <span className="text-slate-200">{m.conversations} محادثة · {m.bookings} حجز</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">قائمة الانتظار</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-300">إجمالي القيود</span><span className="text-slate-100">{fmtNum(wl.total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نشطة</span><span className="text-slate-100">{fmtNum(wl.byStatus.active)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">تم إشعارها بعرض</span><span className="text-slate-100">{fmtNum(wl.byStatus.notified)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">تحولت إلى حجز</span><span className="text-emerald-300">{fmtNum(wl.byStatus.booked)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">منتهية</span><span className="text-slate-100">{fmtNum(wl.byStatus.expired)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">ملغاة</span><span className="text-slate-100">{fmtNum(wl.byStatus.cancelled)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">نسبة تحويل العروض</span><span className="text-slate-100">{fmtPct(wl.offerConversionRate)}</span></div>
        </div>
      </div>
    </div>
  );
}

function RecommendationsCard({ data }: { data: Report }) {
  if (data.recommendations.length === 0) return null;
  const severityLabel: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
  return (
    <DashboardSection title="توصيات (إرشادية)" subtitle="معلوماتية فقط — لا تُنفَّذ أي إجراء تلقائيًا.">
      <ul className="space-y-2">
        {data.recommendations.map((rec, idx) => (
          <li key={`${rec.code}-${idx}`} className="flex items-start gap-2 text-sm text-slate-200">
            <span className={`mt-0.5 rounded-full border px-2 py-0.5 text-[10px] ${severityTone[rec.severity]}`}>
              {severityLabel[rec.severity]}
            </span>
            <span>{rec.message}</span>
          </li>
        ))}
      </ul>
    </DashboardSection>
  );
}
