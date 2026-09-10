import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { SUBSCRIPTION_PLANS } from '@/lib/subscription/plans';
import { getPlanOrFallback } from '@/lib/subscription/planCatalog';
import { getEntitlementState, buildUsageSummary } from '@/lib/subscription/entitlements';
import { billingPeriodLabelAr } from '@/lib/dashboard/labels-ar';

const planIdSchema = z.object({ plan_id: z.enum(SUBSCRIPTION_PLANS.map((p) => p.id) as [string, ...string[]]) });

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const roleGate = roleDenied(authorization, ADMIN_ROLES);
    if (roleGate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // STEP 15G-A — deleted_at consistency: the entitled row lookup ignores soft-deleted rows.
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new Error(error.message);

    // STEP 15C — server-side entitlement snapshot (effective plan / limits / current usage).
    const entitlements = await getEntitlementState(clinicId);
    // STEP 15G-A — derived server-side usage list; null/unlimited resolved here (never client-side).
    const usage = buildUsageSummary(entitlements.resources);

    // STEP 15G-A — whitelisted public subscription row. Never exposes internal /
    // Stripe columns (billing_customer_id, ids, timestamps, deleted_at).
    const subscription = data
      ? {
          plan_id: String(data.plan_id),
          status: (data.status as string | null) ?? null,
          billing_status: (data.billing_status as string | null) ?? null,
          current_period_start: (data.current_period_start as string | null) ?? null,
          current_period_end: (data.current_period_end as string | null) ?? null,
          trial_end: (data.trial_end as string | null) ?? null,
          cancel_at_period_end: Boolean(data.cancel_at_period_end),
        }
      : null;

    // STEP 15G-A — public plan card: no stripe_price_id, no metadata, no raw limits.
    const plan = await getPlanOrFallback(data?.plan_id ?? null);
    const planSummary = {
      id: plan.id,
      name: plan.name,
      nameEn: plan.nameEn,
      pricePerMonth: plan.pricePerMonth,
      currency: plan.currency,
      interval: plan.interval,
      trialDays: plan.trialDays,
      features: plan.features,
    };

    const billingPeriodLabel = billingPeriodLabelAr(entitlements.periodStart);

    return NextResponse.json({
      data: {
        subscription,
        plan: planSummary,
        entitlements: {
          planId: entitlements.planId,
          status: entitlements.status,
          degraded: entitlements.degraded,
          periodStart: entitlements.periodStart,
          resources: entitlements.resources,
        },
        usage,
        billingPeriodLabel,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logEvent('clinic_subscription_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'تعذر تحميل بيانات الاشتراك' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const roleGate = roleDenied(authorization, ADMIN_ROLES);
    if (roleGate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const parsed = planIdSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_PLAN', details: parsed.error.errors }, { status: 400 });
    }

    const plan = await getPlanOrFallback(parsed.data.plan_id);

    // STEP 15A — close the self-grant hole: paid plans (founding/growth/pro) may
    // ONLY be activated through Stripe Checkout. The plain records endpoint only
    // manages free/trial plans; any paid plan request must go to
    // POST /api/payments/checkout.
    if (plan.pricePerMonth > 0) {
      return NextResponse.json({
        error: 'PAID_PLAN_NEEDS_CHECKOUT',
        message: 'الخطط المدفوعة تُفعَّل عبر بوابة الدفع فقط.',
      }, { status: 400 });
    }

    const now = new Date();

    // Trial plan: start period now, trial_end 14 days out, status trialing.
    let status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' = 'active';
    let currentPeriodEnd = new Date(now);
    currentPeriodEnd.setMonth(now.getMonth(), now.getDate() > 28 ? 28 : now.getDate() + 0);
    currentPeriodEnd.setDate(now.getDate() + 30);
    if (plan.interval === 'trial' && plan.trialDays) {
      status = 'trialing';
      currentPeriodEnd = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
    }

    // Use a read-then-write pattern (avoids depending on a unique constraint that
    // may not exist). One active subscription row per clinic is maintained.
    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();

    const payload = {
      clinic_id: clinicId,
      plan_id: plan.id,
      billing_status: plan.interval,
      status,
      current_period_start: now.toISOString(),
      current_period_end: currentPeriodEnd.toISOString(),
      trial_end: plan.interval === 'trial' ? currentPeriodEnd.toISOString() : null,
      cancel_at_period_end: false,
      deleted_at: null,
    };

    let result;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      result = data;
    }

    logEvent('clinic_subscription_updated', { clinic_id: clinicId, plan_id: plan.id });
    return NextResponse.json({ data: { ...result, plan } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logEvent('clinic_subscription_post_error', { error: message }, 'error');
    return NextResponse.json({ error: 'تعذر حفظ الاشتراك' }, { status: 500 });
  }
}