/**
 * checkout.session.completed → subscription ACTIVATION (source of truth).
 *
 * Steps: metadata validation → plan resolution (server-side) → cheap session
 * idempotency → cross-check the REAL Stripe session (price/currency/amount/
 * clinic) fail-closed → single-row update/insert (one effective subscription
 * per tenant is DB-enforced by uq_subscriptions_one_active_per_clinic).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getCheckoutSession } from '@/lib/payments/stripe';
import { getPlanOrFallback, getStripePriceIdAsync } from '@/lib/subscription/planCatalog';

export async function handleCheckoutCompleted(checkout: Record<string, unknown>): Promise<void> {
  const clinicId: string | undefined = checkout?.client_reference_id as string;
  const sessionId: string | undefined = checkout?.id as string;
  const metadata = (checkout?.metadata ?? {}) as Record<string, unknown>;
  const planId: string | undefined = metadata?.plan_id as string;
  const metadataClinicId: string | undefined = metadata?.clinic_id as string;
  const customer: string | undefined = checkout?.customer as string;
  const stripeSubscription: string | undefined = checkout?.subscription as string;
  if (!clinicId || !sessionId) return;

  if (!planId) {
    logEvent('payment_webhook_missing_plan_metadata', { session_id: sessionId, clinic_id: clinicId }, 'error');
    return;
  }
  if (metadataClinicId && metadataClinicId !== clinicId) {
    logEvent('payment_webhook_metadata_mismatch', { session_id: sessionId, clinic_id: clinicId, metadata_clinic_id: metadataClinicId }, 'error');
    return;
  }
  const plan = await getPlanOrFallback(planId);
  if (plan.pricePerMonth <= 0) {
    logEvent('payment_webhook_non_payable_plan', { session_id: sessionId, plan_id: planId }, 'error');
    return;
  }
  const expectedPriceId = await getStripePriceIdAsync(planId);
  if (!expectedPriceId) {
    logEvent('payment_webhook_price_not_configured', { session_id: sessionId, plan_id: planId }, 'error');
    return;
  }

  // Cheap idempotency before any Stripe re-fetch or write.
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id, stripe_checkout_session_id, status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (existing?.stripe_checkout_session_id === sessionId && existing?.status === 'active') return;

  // Cross-check the REAL session on Stripe before activating (fail closed).
  let verified = false;
  try {
    const session = await getCheckoutSession(sessionId);
    const firstItem = Array.isArray(session?.line_items) ? session.line_items[0] : null;
    const actualPriceId: string | undefined = firstItem?.price?.id;
    const actualCurrency: string | undefined = session?.currency;
    const actualAmount: number | undefined = session?.amount_total;
    const actualClinic = session?.client_reference_id;
    if (
      actualPriceId === expectedPriceId &&
      actualCurrency === plan.currency &&
      actualAmount === plan.pricePerMonth &&
      actualClinic === clinicId
    ) {
      verified = true;
    } else {
      logEvent('payment_webhook_price_mismatch', {
        session_id: sessionId, plan_id: planId, expected_price_id: expectedPriceId,
        actual_price_id: actualPriceId ?? null, expected_currency: plan.currency,
        actual_currency: actualCurrency ?? null, expected_amount: plan.pricePerMonth,
        actual_amount: actualAmount ?? null, clinic_id: clinicId,
      }, 'error');
    }
  } catch (err) {
    logEvent('payment_webhook_session_fetch_failed', {
      session_id: sessionId, error: err instanceof Error ? err.message : String(err),
    }, 'error');
  }
  if (!verified) return;

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(now.getMonth() + 1);

  const payload = {
    clinic_id: clinicId,
    plan_id: planId,
    status: 'active' as const,
    billing_status: 'monthly',
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    billing_customer_id: customer ?? null,
    stripe_customer_id: customer ?? null,
    stripe_subscription_id: stripeSubscription ?? null,
    stripe_checkout_session_id: sessionId,
    deleted_at: null,
  };

  if (existing) {
    const { error } = await supabaseAdmin.from('subscriptions').update(payload).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from('subscriptions').insert(payload);
    if (error) throw new Error(error.message);
  }
  logEvent('stripe_checkout_completed', { clinic_id: clinicId, session_id: sessionId, plan_id: planId });
}