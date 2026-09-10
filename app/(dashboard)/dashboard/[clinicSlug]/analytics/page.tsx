'use client';

import { useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';
import { RESOURCE_LABELS_AR } from '@/lib/subscription/entitlements';

type ResourceUsage = {
  resource: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
};

type ProviderScheduleMetrics = {
  providerId: string;
  name: string;
  appointments: number;
  completed: number;
  cancelled: number;
  noShow: number;
  occupiedMinutes: number;
  availableMinutes: number;
  gapMinutes: number;
  utilization: number | null;
};

type OperationsPayload = {
  period: { from: string; to: string };
  funnel: {
    conversations: number;
    bookings: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
    conversationToBookingRate: number;
    confirmationRate: number;
    completionRate: number;
    cancellationRate: number;
    noShowRate: number;
    serviceIdLinkedBookings: number;
    serviceIdLinkageRate: number;
  };
  schedule: ProviderScheduleMetrics[];
  aiUsage: ResourceUsage[];
};

const PERIOD_OPTIONS = [
  { label: '٧ أيام', days: 7 },
  { label: '٣٠ يومًا', days: 30 },
  { label: '٩٠ يومًا', days: 90 },
];

function periodRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function AnalyticsPage() {
  const { clinicId, authHeaders } = useClinicContext();
  const [data, setData] = useState<OperationsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

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
        const range = periodRange(days);
        const url = `/api/clinic/analytics/operations?clinic_id=${encodeURIComponent(clinicId as string)}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
        const response = await fetch(url, { headers: await authHeaders() });
        if (!response.ok) throw new Error('خدمة التحليلات غير متاحة');
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

  const funnel = data?.funnel;
  const cards = funnel
    ? [
        { label: 'المحادثات', value: funnel.conversations },
        { label: 'الحجوزات', value: funnel.bookings },
        { label: 'مؤكدة/مكتملة', value: funnel.confirmed },
        { label: 'مكتملة', value: funnel.completed },
        { label: 'ملغاة', value: funnel.cancelled },
        { label: 'لم يحضر', value: funnel.noShow },
      ]
    : [];
  const rates = funnel
    ? [
        { label: 'محادثة → حجز', value: funnel.conversationToBookingRate },
        { label: 'نسبة التأكيد', value: funnel.confirmationRate },
        { label: 'نسبة الإكمال', value: funnel.completionRate },
        { label: 'نسبة الإلغاء', value: funnel.cancellationRate },
        { label: 'نسبة عدم الحضور', value: funnel.noShowRate },
      ]
    : [];

  return (
    <div className="space-y-6">
      <DashboardSection
        title="ذكاء العمليات"
        subtitle="قمع التحويل، كفاءة الجدولة، واستخدام الذكاء الاصطناعي مقابل حدود الخطة."
        action={
          <div className="flex gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                onClick={() => setDays(option.days)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  days === option.days
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
          <EmptyState title="لا توجد عيادة محددة" description="اختر عيادة من القائمة لعرض مؤشراتها التشغيلية." />
        ) : loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : error ? (
          <EmptyState title="خدمة التحليلات غير متاحة" description={error} />
        ) : data && funnel ? (
          <>
            <FunnelCards
              cards={cards}
              rates={rates}
              linkage={{ linked: funnel.serviceIdLinkedBookings, total: funnel.bookings, rate: funnel.serviceIdLinkageRate }}
            />
            <ScheduleUsage schedule={data.schedule} aiUsage={data.aiUsage} />
          </>
        ) : null}
      </DashboardSection>
    </div>
  );
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} د`;
  return `${Math.round((minutes / 60) * 10) / 10} س`;
}

function FunnelCards({
  cards,
  rates,
  linkage,
}: {
  cards: Array<{ label: string; value: number }>;
  rates: Array<{ label: string; value: number }>;
  linkage: { linked: number; total: number; rate: number };
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm text-slate-400">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {rates.map((rate) => (
          <div key={rate.label} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm text-slate-400">{rate.label}</p>
            <p className="mt-2 text-xl font-semibold text-cyan-300">{pct(rate.value)}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        ارتباط الحجوزات بالخدمات: {linkage.linked} من {linkage.total} ({pct(linkage.rate)}) — أساس الفوترة المستقبلية.
      </p>
    </div>
  );
}

function ScheduleUsage({
  schedule,
  aiUsage,
}: {
  schedule: ProviderScheduleMetrics[];
  aiUsage: ResourceUsage[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <p className="text-sm font-semibold text-white">إشغال مقدمي الخدمة</p>
        <div className="mt-4 space-y-4">
          {schedule.length === 0 ? (
            <p className="text-sm text-slate-500">لا يوجد مقدمو خدمة بعد.</p>
          ) : (
            schedule.map((provider) => (
              <div key={provider.providerId}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                  <span>{provider.name}</span>
                  <span className="text-slate-400">
                    إشغال {provider.utilization == null ? '—' : pct(provider.utilization)} · مشغول {hoursLabel(provider.occupiedMinutes)} · فجوات {hoursLabel(provider.gapMinutes)} · متاح {hoursLabel(provider.availableMinutes)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-900">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500"
                    style={{
                      width: `${provider.utilization == null ? 0 : Math.min(provider.utilization * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  مواعيد {provider.appointments} · مكتملة {provider.completed} · ملغاة {provider.cancelled} · عدم حضور {provider.noShow}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <p className="text-sm font-semibold text-white">استخدام الذكاء الاصطناعي مقابل الخطة</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {aiUsage.map((usage) => (
            <div key={usage.resource} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-sm text-slate-300">{RESOURCE_LABELS_AR[usage.resource] ?? usage.resource}</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {usage.unlimited ? (
                  <span className="text-emerald-400">غير محدود</span>
                ) : (
                  <>
                    {usage.used} / {usage.limit}
                    {usage.remaining != null ? <span className="text-sm text-slate-400"> · متبقٍ {usage.remaining}</span> : null}
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

