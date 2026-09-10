/**
 * Subscription lifecycle event handlers (non-activation).
 * These NEVER change plan_id; checkout.session.completed is the activation
 * source of truth. They only maintain honest lifecycle state.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/** invoice.paid → keep the subscription active, refresh the period window. */
export async function handleInvoicePaid(invoice: Record<string, unknown>): Promise<void> {
  const customer = invoice?.customer as string | undefined;
  const subId = invoice?.subscription as string | undefined;
  if (!customer && !subId) return;

  const base = supabaseAdmin.from('subscriptions').select('id').is('deleted_at', null).limit(1);
  const { data } = subId
    ? await base.eq('stripe_subscription_id', subId).maybeSingle()
    : await base.eq('billing_customer_id', customer).maybeSingle();
  if (data) {
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await supabaseAdmin.from('subscriptions').update({ status: 'active', current_period_end: periodEnd.toISOString() }).eq('id', data.id);
    logEvent('stripe_invoice_paid', { customer: customer ?? subId ?? null });
  }
}

/** invoice.payment_failed → past_due. */
export async function handlePaymentFailed(invoice: Record<string, unknown>): Promise<void> {
  const customer = invoice?.customer as string | undefined;
  if (!customer) return;
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('billing_customer_id', customer)
    .is('deleted_at', null)
    .maybeSingle();
  if (data) {
    await supabaseAdmin.from('subscriptions').update({ status: 'past_due' }).eq('id', data.id);
    logEvent('stripe_payment_failed', { customer });
  }
}

/** customer.subscription.deleted → canceled. */
export async function handleSubscriptionDeleted(subscription: Record<string, unknown>): Promise<void> {
  const stripeSub = subscription?.id as string | undefined;
  if (!stripeSub) return;
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', stripeSub)
    .is('deleted_at', null)
    .maybeSingle();
  if (data) {
    await supabaseAdmin.from('subscriptions').update({ status: 'canceled', cancel_at_period_end: true }).eq('id', data.id);
    logEvent('stripe_subscription_canceled', { stripe_sub_id: stripeSub });
  }
}

/**
 * customer.subscription.created/updated → period resync ONLY (for an already
 * tracked active subscription). Never changes plan or downgrades status.
 */
export async function handleSubscriptionLifecycle(subscription: Record<string, unknown>): Promise<void> {
  const stripeSub = subscription?.id as string | undefined;
  if (!stripeSub) return;
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('id, status')
    .eq('stripe_subscription_id', stripeSub)
    .is('deleted_at', null)
    .maybeSingle();
  if (data?.id && data.status === 'active' && subscription?.status === 'active') {
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await supabaseAdmin.from('subscriptions').update({ current_period_end: periodEnd.toISOString() }).eq('id', data.id);
    logEvent('stripe_subscription_lifecycle', { stripe_sub_id: stripeSub, status: subscription.status ?? null });
  }
}