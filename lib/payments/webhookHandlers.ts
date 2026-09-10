/**
 * Stripe webhook domain handlers — the ONLY place that turns a verified Stripe
 * event into a DB subscription write.
 *
 * Source of truth for ACTIVATION: `checkout.session.completed` alone flips a
 * subscription to active. Other events only maintain lifecycle state:
 *   - invoice.paid                          → keep active, refresh period
 *   - invoice.payment_failed                → past_due
 *   - customer.subscription.deleted         → canceled
 *   - customer.subscription.created/updated → acknowledged (period resync only)
 *
 * Safety invariants:
 *   * Durable idempotency by Stripe event id (stripe_webhook_events).
 *   * Cross-check against the REAL Stripe session before activation — fail closed.
 *   * ONE effective subscription per tenant (DB partial unique index).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { wasStripeEventProcessed, markStripeEventProcessed } from '@/lib/payments/webhookDedup';
import { handleCheckoutCompleted } from '@/lib/payments/webhookCheckoutActivation';
import {
  handleInvoicePaid,
  handlePaymentFailed,
  handleSubscriptionDeleted,
  handleSubscriptionLifecycle,
} from '@/lib/payments/webhookLifecycleHandlers';

export type StripeEventLike = {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
};

export type WebhookResult = { handled: boolean; deduped: boolean; outcome: string };

const SUBSCRIPTION_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

/** Processes a verified Stripe event exactly once (durable ledger). */
export async function processStripeEvent(event: StripeEventLike): Promise<WebhookResult> {
  if (!event?.id || !event?.type) return { handled: false, deduped: false, outcome: 'ignored_malformed' };
  if (!SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    // Portal PAYMENT/REFUND events (PP-3/PP-4) fall through to the webhook route.
    return { handled: false, deduped: false, outcome: 'unhandled' };
  }
  if (await wasStripeEventProcessed(event.id)) {
    return { handled: false, deduped: true, outcome: 'duplicate' };
  }

  const object = event.data?.object as Record<string, unknown> | undefined;
  const clinicId =
    event.type === 'checkout.session.completed'
      ? (object?.client_reference_id as string | undefined) ?? null
      : null;

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(object ?? {});
    } else if (event.type === 'invoice.paid') {
      await handleInvoicePaid(object ?? {});
    } else if (event.type === 'invoice.payment_failed') {
      await handlePaymentFailed(object ?? {});
    } else if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(object ?? {});
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      await handleSubscriptionLifecycle(object ?? {});
    }
    await markStripeEventProcessed(event.id, event.type, clinicId, 'processed');
    return { handled: true, deduped: false, outcome: event.type };
  } catch (err) {
    // NOT marked as processed on failure: Stripe retries the delivery.
    const message = err instanceof Error ? err.message : String(err);
    logEvent('payment_webhook_handler_error', { error: message, type: event.type, event_id: event.id }, 'error');
    throw err;
  }
}