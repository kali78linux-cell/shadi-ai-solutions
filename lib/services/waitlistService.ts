/**
 * PHASE 2 — Waitlist + Cancellation Rules (server-only).
 *
 * Waitlist: a per-clinic queue for unavailable slots. Entries are created
 * server-side (public or admin), and when a slot F REES up (appointment
 * cancelled), the most relevant active waitlist entries are notified.
 * Matching is data-driven (preferred provider/service/date/window), never
 * invented.
 *
 * Cancellation rules: staff cancellations flip the appointment to `cancelled`
 * and — when the cancel endpoint is used — run waitlist matching afterwards.
 * Public cancellation (token-based) keeps its existing flow.
 *
 * Never import from a client component.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export type WaitlistEntry = {
  id: string;
  clinic_id: string;
  provider_id: string | null;
  service_id: string | null;
  preferred_date: string | null;
  preferred_window: string | null;
  contact_name: string;
  contact_phone: string;
  status: string;
  notes: string | null;
  created_at: string;
};

export type MatchResult = {
  entriesNotified: number;
};

// ─── Create ───────────────────────────────────────────────────────────────────

export async function addToWaitlist(params: {
  clinicId: string;
  contactName: string;
  contactPhone: string;
  providerId?: string | null;
  serviceId?: string | null;
  preferredDate?: string | null;
  preferredWindow?: 'morning' | 'afternoon' | 'evening' | 'any' | null;
  notes?: string | null;
}): Promise<WaitlistEntry> {
  const { data, error } = await supabaseAdmin
    .from('appointment_waitlist')
    .insert({
      clinic_id: params.clinicId,
      contact_name: params.contactName,
      contact_phone: params.contactPhone,
      provider_id: params.providerId ?? null,
      service_id: params.serviceId ?? null,
      preferred_date: params.preferredDate ?? null,
      preferred_window: params.preferredWindow ?? null,
      notes: params.notes ?? null,
      status: 'active',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as WaitlistEntry;
}

// ─── List (admin, tenant-scoped) ──────────────────────────────────────────────

export async function listWaitlist(params: {
  clinicId: string;
  status?: string;
  limit?: number;
}): Promise<WaitlistEntry[]> {
  let query = supabaseAdmin
    .from('appointment_waitlist')
    .select('*')
    .eq('clinic_id', params.clinicId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (params.status) query = query.eq('status', params.status);
  if (params.limit) query = query.limit(params.limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as WaitlistEntry[];
}

// ─── Cancel waitlist entry (admin or self) ────────────────────────────────────

export async function cancelWaitlistEntry(clinicId: string, entryId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('appointment_waitlist')
    .update({ status: 'cancelled' })
    .eq('id', entryId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
}

// ─── Matching (called after a cancellation frees a slot) ──────────────────────

/**
 * Marks active waitlist entries as `notified` for the freed slot. Scoring is
 * deterministic and data-driven: preferred provider +1p, preferred service
 * +1p, preferred date +1p, preferred window +1p. Only entries matching at
 * least one dimension are notified; the rest stay active.
 */
export async function matchWaitlistAfterCancellation(params: {
  clinicId: string;
  providerId?: string | null;
  serviceId?: string | null;
  cancelledDate?: string | null;
  cancelledTime?: string | null;
}): Promise<MatchResult> {
  const { clinicId } = params;
  const { data: entries, error } = await supabaseAdmin
    .from('appointment_waitlist')
    .select('id, provider_id, service_id, preferred_date, preferred_window')
    .eq('clinic_id', clinicId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(50);
  if (error) {
    logEvent('waitlist_match_error', { clinicId, error: error.message }, 'error');
    return { entriesNotified: 0 };
  }

  const cancelledTimeMinutes = params.cancelledTime ? minutesOf(params.cancelledTime) : null;
  const cancelledWindow = cancelledTimeMinutes !== null ? windowOf(cancelledTimeMinutes) : null;

  const matches = (entries ?? []).filter((e: any) => {
    let score = 0;
    if (params.providerId && e.provider_id === params.providerId) score += 1;
    if (params.serviceId && e.service_id === params.serviceId) score += 1;
    if (params.cancelledDate && e.preferred_date === params.cancelledDate) score += 1;
    if (cancelledWindow && e.preferred_window === cancelledWindow) score += 1;
    if (e.preferred_window === 'any') score += 0; // neutral
    return score > 0;
  });

  if (matches.length === 0) return { entriesNotified: 0 };

  const ids = matches.map((m: any) => m.id);
  const { error: updateError } = await supabaseAdmin
    .from('appointment_waitlist')
    .update({ status: 'notified', updated_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
    .in('id', ids)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (updateError) {
    logEvent('waitlist_match_update_error', { clinicId, error: updateError.message }, 'error');
    return { entriesNotified: 0 };
  }

  logEvent('waitlist_matched_after_cancellation', { clinicId, entriesNotified: matches.length });
  return { entriesNotified: matches.length };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function windowOf(minutes: number): 'morning' | 'afternoon' | 'evening' {
  if (minutes < 720) return 'morning';
  if (minutes < 1020) return 'afternoon';
  return 'evening';
}