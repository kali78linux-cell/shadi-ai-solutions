import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { SUBSCRIPTION_PLANS } from '@/lib/subscription/plans';
import { FOUNDING_SLOTS_TOTAL } from '@/lib/landing/landing-copy';
import { createCheckoutSession, getStripeConfig } from '@/lib/payments/stripe';

const bodySchema = z.object({
  plan_id: z.enum(SUBSCRIPTION_PLANS.map((p) => p.id) as [string, ...string[]]),
  return_url: z.string().url().optional(),
});

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }
    // Only owner/manager may start a paid checkout for the clinic.
    const roleGate = roleDenied(authorization, ADMIN_ROLES);
    if (roleGate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_PLAN', details: parsed.error.errors }, { status: 400 });

    // Resolve the plan SERVER-SIDE. The amount/price is never taken from client input.
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === parsed.data.plan_id)!;
    if (plan.pricePerMonth === 0 || !plan.priceId) {
      return NextResponse.json({ error: 'هذه الباقة لا تتطلب دفعاً' }, { status: 400 });
    }

    // Founding plan eligibility is enforced SERVER-SIDE from the database:
    // the clinic must carry is_founding_member=true AND the founding cohort
    // must not exceed FOUNDING_SLOTS_TOTAL. Never trusted from the client.
    if (plan.id === 'founding') {
      const { data: clinicRow } = await supabaseAdmin
        .from('clinics')
        .select('is_founding_member')
        .eq('id', clinicId)
        .is('deleted_at', null)
        .maybeSingle();
      const { count } = await supabaseAdmin
        .from('clinics')
        .select('id', { count: 'exact', head: true })
        .eq('is_founding_member', true)
        .is('deleted_at', null);
      const foundingFull = (count ?? 0) >= FOUNDING_SLOTS_TOTAL;
      if (!clinicRow?.is_founding_member || foundingFull) {
        logEvent('payment_checkout_founding_rejected', { clinic_id: clinicId, founding_full: foundingFull });
        return NextResponse.json(
          { error: 'FOUNDING_UNAVAILABLE', message: 'باقة التأسيس غير متاحة لهذه العيادة (المقاعد التأسيسية مكتملة).' },
          { status: 409 }
        );
      }
    }

    const config = getStripeConfig();
    if (config.mode === 'unconfigured') {
      // Honest failure: no Stripe credentials configured (TEST mode not set up).
      return NextResponse.json(
        { error: 'PAYMENT_NOT_CONFIGURED', mode: config.mode },
        { status: 503 }
      );
    }

    const returnUrl = parsed.data.return_url ?? `${new URL(req.url).origin}/dashboard/subscription`;
    const session = await createCheckoutSession({
      priceId: plan.priceId,
      successUrl: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&clinic_id=${clinicId}`,
      cancelUrl: returnUrl,
      clientReferenceId: clinicId,
      metadata: { plan_id: plan.id, clinic_id: clinicId },
    });

    // Store an idempotency/processing marker (a pending subscription row keyed by session).
    await recordPendingSubscription(clinicId, plan.id, session.id);

    logEvent('payment_checkout_created', { clinic_id: clinicId, plan_id: plan.id, mode: config.mode, session_id: session.id });
    return NextResponse.json({ url: session.url, session_id: session.id, mode: config.mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logEvent('payment_checkout_error', { error: message }, 'error');
    return NextResponse.json({ error: 'تعذر إنشاء جلسة الدفع' }, { status: 500 });
  }
}

async function recordPendingSubscription(clinicId: string, planId: string, sessionId: string) {
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  const payload = {
    clinic_id: clinicId,
    plan_id: planId,
    status: 'unpaid' as const,
    billing_status: 'monthly',
    stripe_checkout_session_id: sessionId,
    deleted_at: null,
  };
  if (existing) {
    await supabaseAdmin.from('subscriptions').update(payload).eq('id', existing.id);
  } else {
    await supabaseAdmin.from('subscriptions').insert(payload);
  }
}