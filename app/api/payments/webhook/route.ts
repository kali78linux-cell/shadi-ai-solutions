// Stripe webhook (server-side, no auth — protected by Stripe signature verification).
// Idempotent by checkout session id. No user faces this route.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getStripeConfig, verifyStripeSignature } from '@/lib/payments/stripe';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const config = getStripeConfig();
  const signature = req.headers.get('stripe-signature');

  if (!verifyStripeSignature(rawBody, signature, config.webhookSecret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data?.object);
    } else if (event.type === 'invoice.payment_failed') {
      await handlePaymentFailed(event.data?.object);
    } else if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(event.data?.object);
    }
    // Unknown events are acknowledged (idempotent/no-op).
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('payment_webhook_handler_error', { error: message, type: event.type }, 'error');
    return NextResponse.json({ error: 'handler error' }, { status: 500 });
  }
}

async function handleCheckoutCompleted(checkout: any) {
  const clinicId: string | undefined = checkout.client_reference_id;
  const sessionId: string | undefined = checkout.id;
  const planMeta: string | undefined = checkout?.metadata?.plan_id;
  const customer: string | undefined = checkout?.customer;
  const stripeSubscription: string | undefined = checkout?.subscription;
  if (!clinicId || !sessionId) return;

  // Idempotency: skip ONLY if this session was already fully processed
  // (activated). A pre-created pending row from the checkout route shares the
  // same session id with status='unpaid' and MUST still be activated here.
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id, stripe_checkout_session_id, status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (existing?.stripe_checkout_session_id === sessionId && existing?.status === 'active') return;

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(now.getMonth() + 1);

  const payload = {
    clinic_id: clinicId,
    plan_id: planMeta ?? 'growth',
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
    await supabaseAdmin.from('subscriptions').update(payload).eq('id', existing.id);
  } else {
    await supabaseAdmin.from('subscriptions').insert(payload);
  }
  logEvent('stripe_checkout_completed', { clinic_id: clinicId, session_id: sessionId });
}

async function handlePaymentFailed(invoice: any) {
  const customer = invoice?.customer;
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

async function handleSubscriptionDeleted(subscription: any) {
  const stripeSub = subscription?.id;
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