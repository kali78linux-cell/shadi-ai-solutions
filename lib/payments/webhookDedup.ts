/**
 * Stripe webhook idempotency ledger — durable, DB-backed.
 *
 * Stripe may deliver the same event multiple times (retries, hand-triggered
 * replays, multi-endpoint reflections). `stripe_webhook_events` records the
 * Stripe event id exactly once so the same event is never processed twice,
 * even across restarts. Never in-memory.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function wasStripeEventProcessed(eventId: string | null | undefined): Promise<boolean> {
  if (!eventId) return false;
  const { data } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();
  return !!data;
}

export async function markStripeEventProcessed(
  eventId: string,
  type: string,
  clinicId: string | null,
  outcome: 'processed' | 'error' = 'processed'
): Promise<void> {
  if (!eventId) return;
  await supabaseAdmin
    .from('stripe_webhook_events')
    .upsert(
      { event_id: eventId, type, clinic_id: clinicId, outcome },
      { onConflict: 'event_id' }
    );
}