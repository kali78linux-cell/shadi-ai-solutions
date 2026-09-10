'use client';

// STEP 15G-A — Usage & Plan Visibility.
// STEP 15G-B — Upgrade flow & monetization readiness:
//   * reads ?upgrade=1&resource=<r>&plan=<p>  → highlights the suggested upgrade
//   * reads ?session_id=<id>                  → shows a Pending Activation notice
//     (never claims the subscription is active before the webhook confirms it)
//   * keeps the plan picker + checkout flow untouched.

import { useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import { formatMoney } from '@/lib/clinic/formatting';
import Skeleton from '@/components/ui/Skeleton';
import StatusPill from '@/components/dashboard/StatusPill';
import UsageMeter, { type UsageMeterItem } from '@/components/dashboard/subscription/UsageMeter';
import { useClinicContext } from '@/lib/useClinicContext';
import { SUBSCRIPTION_PLANS } from '@/lib/subscription/plans';
import {
  RESOURCE_LABEL_AR,
  suggestedPlanFor,
} from '@/lib/subscription/upgradeCta';
import { resolvePendingSelectedPlan } from '@/lib/subscription/pendingPlan';
import type { EntitlementResource } from '@/lib/subscription/entitlements';

type SubscriptionPublic = {
  plan_id: string;
  status: string | null;
  billing_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
};

type AccessData = {
  subscription: SubscriptionPublic | null;
  plan?: {
    id: string;
    name: string;
    pricePerMonth: number;
    currency: string;
    interval: string;
    trialDays: number | null;
  };
  entitlements: {
    planId: string;
    status: string | null;
    degraded: boolean;
    periodStart: string;
  };
  usage: UsageMeterItem[];
  billingPeriodLabel: string;
};

const STATUS_AR: Record<string, string> = {
  active: 'نشط',
  trialing: 'نسخة تجريبية',
  past_due: 'متأخر الدفع',
  canceled: 'ملغى',
  unpaid: 'غير مدفوع',
};

const PLAN_NAME_AR: Record<string, string> = {
  free_trial: 'تجربة مجانية',
  starter: 'الباقة الابتدائية',
  founding: 'باقة التأسيس',
  growth: 'النمو',
  pro: 'الاحترافية',
};

function statusTone(status: string | null, degraded: boolean): 'success' | 'warning' | 'danger' | 'neutral' {
  if (degraded) return 'warning';
  if (status === 'active' || status === 'trialing') return 'success';
  if (status === 'past_due' || status === 'unpaid' || status === 'canceled') return 'danger';
  return 'neutral';
}

function readQuery(): { upgrade: boolean; resource: string | null; plan: string | null; sessionId: string | null } {
  if (typeof window === 'undefined') return { upgrade: false, resource: null, plan: null, sessionId: null };
  const params = new URLSearchParams(window.location.search);
  return {
    upgrade: params.get('upgrade') === '1',
    resource: params.get('resource'),
    plan: params.get('plan'),
    sessionId: params.get('session_id'),
  };
}

export default function SubscriptionPage() {
  const { clinicId, authHeaders, loading, error: clinicError } = useClinicContext();
  const [data, setData] = useState<AccessData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState(readQuery);

  async function load() {
    if (!clinicId) return null;
    const headers = await authHeaders();
    const res = await fetch(`/api/clinic/subscription?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
    if (res.ok) {
      const body = await res.json();
      const incoming = body?.data as AccessData | undefined;
      setData(incoming ?? null);
      setErr(null);
      return incoming?.subscription?.status ?? null;
    }
    // PHASE F — surface the REAL failure instead of a silent null that renders
    // a generic empty view. 401 (expired/missing session) gets a clear CTA.
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.status === 401) {
      setLoadError('انتهت الجلسة أو لم تُسجَّل الدخول. اضغط «إعادة تسجيل الدخول» للمتابعة.');
    } else if (res.status === 403) {
      setLoadError('لا تملك صلاحية عرض الاشتراك لهذه العيادة (403).');
    } else if (res.status === 500) {
      setLoadError('حدث خطأ في الخادم، حاول مرة أخرى');
    } else {
      const detail = (body as { error?: string; message?: string });
      setLoadError(`تعذر تحميل الاشتراك (${res.status}). ${detail?.message ?? detail?.error ?? ''}`.trim());
    }
    setData(null);
    return null;
  }

  useEffect(() => {
    if (loading) return;
    if (!clinicId) return;
    const q = readQuery();
    setQuery(q);
    void load();

    // Webhook race: the user can return from Checkout BEFORE the Stripe webhook
    // reaches the server. Poll the real API (no cache) until the subscription
    // becomes active or the poll budget is spent — never a permanent Starter.
    if (q.sessionId) {
      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        const status = await load();
        if (status === 'active' || attempts >= 6) {
          window.clearInterval(timer);
        }
      }, 4000);
      return () => window.clearInterval(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, clinicId]);


  async function choose(planId: string) {
    if (!clinicId) return;
    setBusy(true); setErr(null);
    try {
      const headers = await authHeaders();
      const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
      const endpoint = plan && plan.pricePerMonth > 0 ? '/api/payments/checkout' : '/api/clinic/subscription';
      const res = await fetch(`${endpoint}?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        if (b?.error === 'PAYMENT_NOT_CONFIGURED') {
          setErr('الدفع غير مفعّل بعد: لم تُهيّأ مفاتيح Stripe الاختبارية.');
        } else if (b?.error === 'FOUNDING_UNAVAILABLE') {
          setErr(b?.message || 'باقة التأسيس غير متاحة لهذه العيادة (المقاعد التأسيسية مكتملة).');
        } else {
          setErr(b?.message || b?.error || 'تعذر إتمام العملية');
        }
        return;
      }
      const body = await res.json();
      if (body?.url) {
        window.location.assign(body.url); // Stripe Checkout; activation is confirmed by the webhook, not the redirect
        return;
      }
      // Free/trial plans resolve directly to a records row — reload the access view.
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setBusy(false);
    }
  }

  function formatPrice(plan: { pricePerMonth: number; interval: string; currency: string }) {
    if (plan.pricePerMonth === 0) return 'مجاناً';
    // Centralized formatting (D-L4) — platform currency display stays single-currency.
    const major = formatMoney(plan.pricePerMonth / 100, plan.currency, 'ar');
    const per = plan.interval === 'year' ? '/سنة' : '/شهر';
    return `${major}${per}`;
  }

  if (loading) return <Skeleton className="h-60" />;
  if (clinicError) return <EmptyState title="تعذر تحميل الاشتراك" description={clinicError} />;
  if (!clinicId) return <EmptyState title="لا توجد عيادة" description="سجّل الدخول لرؤية الاشتراك." />;

  // STEP 15G-A — the APPLIED plan is entitlements.planId (never the raw plan_id).
  const appliedPlanId = data?.entitlements?.planId ?? 'free_trial';
  const appliedStatus = data?.subscription?.status ?? null;
  const degraded = data?.entitlements?.degraded ?? false;
  const appliedPlanName = PLAN_NAME_AR[appliedPlanId] ?? appliedPlanId;
  const periodLabel = data?.billingPeriodLabel ?? '';
  const periodEnd = data?.subscription?.current_period_end ?? null;

  // STEP 15G-C — selected plan awaiting payment (subscription row keeps the
  // chosen plan_id while status=unpaid; entitlements stay degraded at starter).
  const pendingPlanId = resolvePendingSelectedPlan(data?.subscription ?? null);
  const pendingPlanName = pendingPlanId ? PLAN_NAME_AR[pendingPlanId] ?? pendingPlanId : null;

  // STEP 15G-B — contextual upgrade params.
  const upgradeResource = query.resource && query.resource in RESOURCE_LABEL_AR
    ? (query.resource as EntitlementResource)
    : null;
  const upgradePlan = query.plan && SUBSCRIPTION_PLANS.some((p) => p.id === query.plan)
    ? query.plan
    : null;
  const suggestedPlan = upgradeResource ? (upgradePlan ?? suggestedPlanFor(upgradeResource)) : null;
  const upgradeUsage = upgradeResource
    ? (data?.usage?.find((u) => u.resource === upgradeResource) ?? null)
    : null;


  return (
    <DashboardSection title="الاشتراك" subtitle="اختر باقة تناسب عيادتك؛ تُحفظ في ملف العيادة وتُطبَّق على الحجز والاستخدام.">

      {/* STEP 15G-B — Pending activation after returning from Checkout. */}
      {query.sessionId ? (
        <div className="mb-5 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-4">
          <p className="text-sm font-semibold text-cyan-200">الدفع قيد التأكيد</p>
          <p className="mt-1 text-xs text-cyan-200/70">
            استلمنا جلسة الدفع (رقمها ينتهي بـ …{query.sessionId.slice(-8)}). سيُفعَّل اشتراكك
            تلقائيًا بعد تأكيد مزوّد الدفع وفحصه — عادةً خلال دقائق. لم يُفعَّل أي تغيير على خطتك الحالية قبل هذا التأكيد.
          </p>
        </div>
      ) : null}

      {/* STEP 15G-C — selected plan awaiting payment: show the CHOSEN plan
          clearly instead of silently displaying the degraded Starter plan. */}
      {pendingPlanId && pendingPlanName ? (
        <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
          <p className="text-sm font-semibold text-amber-200">
            {pendingPlanName} — بانتظار إتمام الدفع
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            حفظنا اختيارك لباقة «{pendingPlanName}»، وستصبح خطتك الفعّالة فور تأكيد
            مزوّد الدفع. حتى ذلك الحين تعمل عيادتك بحدود الخطة الابتدائية.
          </p>
        </div>
      ) : null}

      {/* Plan + subscription status (15G-A) */}
      <div className="mb-6 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-400">الخطة الحالية</p>
            <p className="mt-2 text-2xl font-semibold text-white">{appliedPlanName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {appliedStatus ? (
                <StatusPill tone={statusTone(appliedStatus, degraded)}>
                  {STATUS_AR[appliedStatus] ?? appliedStatus}
                </StatusPill>
              ) : (
                <StatusPill tone="neutral">بدون اشتراك مسجل</StatusPill>
              )}
              {degraded && <StatusPill tone="warning">بحدود الابتدائية مؤقتًا</StatusPill>}
            </div>
          </div>
          <div className="text-left sm:text-right">
            {periodLabel ? <p className="text-sm text-slate-300">فترة الاستخدام: {periodLabel}</p> : null}
            {periodEnd ? (
              <p className="mt-1 text-sm text-slate-400">تنتهي الدورة: {new Date(periodEnd).toLocaleDateString('ar')}</p>
            ) : null}
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
      </div>

      {loadError ? (
        <div className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-4">
          <p className="text-sm font-semibold text-rose-200">تعذر تحميل بيانات الاشتراك</p>
          <p className="mt-1 text-xs text-rose-200/80">{loadError}</p>
          {loadError.includes('401') || loadError.includes('الجلسة') ? (
            <a href="/login" className="mt-2 inline-block rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400">إعادة تسجيل الدخول</a>
          ) : (
            <button type="button" onClick={() => void load()} className="mt-2 inline-block rounded-full border border-rose-400/50 px-4 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/10">إعادة المحاولة</button>
          )}
        </div>
      ) : null}

      {/* STEP 15G-B — contextual upgrade section when arriving from an entitlement limit. */}
      {upgradeResource && upgradeUsage ? (
        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
          <p className="text-sm font-semibold text-amber-200">
            وصلتَ إلى حد {RESOURCE_LABEL_AR[upgradeResource]} في هذه الفترة.
          </p>
          {!upgradeUsage.unlimited && upgradeUsage.limit != null ? (
            <p className="mt-1 text-xs text-amber-200/70">
              الاستهلاك الحالي: {upgradeUsage.used} من {upgradeUsage.limit}.
            </p>
          ) : null}
          {suggestedPlan ? (
            <p className="mt-1 text-xs text-amber-200/70">
              ننصح بالاطلاع على خطة «{PLAN_NAME_AR[suggestedPlan] ?? suggestedPlan}» لرفع هذا الحد.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Usage meter (15G-A) */}
      <div className="mb-6">
        <h3 className="mb-3 text-base font-semibold text-white">استهلاك هذه الفترة</h3>
        <UsageMeter usage={data?.usage ?? []} />
      </div>

      {/* Plan picker (unchanged behavior) */}
      <div className="grid gap-4 md:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const active = plan.id === appliedPlanId;
          const suggested = query.upgrade && suggestedPlan && plan.id === suggestedPlan;
          return (
            <article
              key={plan.id}
              className={`rounded-[1.5rem] border p-5 ${active ? 'border-cyan-500/70 bg-cyan-500/10' : suggested ? 'border-amber-500/70 bg-amber-500/5' : 'border-slate-800 bg-slate-950/70'}`}
            >
              {suggested && !active ? (
                <span className="mb-2 inline-block rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200">مقترحة للترقية</span>
              ) : null}
              <p className="text-lg font-semibold text-white">{plan.name}</p>
              <p className="mt-1 text-2xl font-semibold text-cyan-300">
                {formatPrice(plan)}
              </p>
              {plan.interval === 'trial' && <p className="mt-1 text-xs text-slate-400">تجربة {plan.trialDays} يوم</p>}
              <ul className="mt-4 space-y-1 text-sm text-slate-300">
                {plan.features.map((f) => <li key={f}>• {f}</li>)}
              </ul>
              <button
                type="button"
                disabled={busy || active}
                onClick={() => choose(plan.id)}
                className="mt-4 w-full rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {active ? 'الباقة الحالية' : plan.pricePerMonth > 0 ? 'الدفع والاشتراك' : 'اختيار مجاني'}
              </button>
            </article>
          );
        })}
      </div>
      <p className="mt-6 text-xs text-slate-500">
        ملاحظة: الدفع الإلكتروني الفعلي يتطلب مزوّد دفع مرخّص (مثل Stripe/PayPal لم يُهيّأ هنا). اختيار باقة يُسجّل حالة اشتراك (تجربة/نشط) للعيادة.
      </p>
    </DashboardSection>
  );
}
