/**
 * STEP 7 — Booking conversation ⇄ Booking UI state bridge.
 *
 * CANONICAL SOURCE = the server-side conversation state:
 *   conversations.metadata.booking  +  metadata.reception_context
 *   + metadata.recommended_service_id / recommended_provider_id
 *   + metadata.state / metadata.patient_confirmed_booking.
 *
 * ChatInterface (client) is a PROJECTION of that state. The two functions here:
 *   1. buildPendingBookingContext(metadata)  → derives the exact fields the UI
 *      needs to reflect (used by the public messages route, POST + GET).
 *   2. applyPendingBookingContext(ui, ctx)   → pure merge of context into UI.
 *   (UI → conversation persistence is handled by a guarded route that re-uses
 *    the existing persistReceptionistSlot + availability validation.)
 *
 * These helpers are PURE (no DB/network) so the mapping is unit-testable and
 * never duplicated across the route and the component.
 */
import { missingBookingFields } from '@/lib/ai/conversationBooking';

export type PendingBookingContext = {
  recommended_service_id: string | null;
  recommended_provider_id: string | null;
  conversation_state: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_email: string | null;
  booking_service_id: string | null;
  booking_provider_id: string | null;
  /** Real proposed slot (ISO datetime) persisted from availability — never invented. */
  slot: string | null;
  patient_confirmed_booking: boolean;
  /** Fields still missing before the guarded booking flow can run. */
  missing: string[];
};

/**
 * Derives the pending-booking projection from the canonical conversation
 * metadata. Additive: returns null when there is no booking signal at all so
 * the UI stays quiet (no invented prefill).
 */
export function buildPendingBookingContext(
  meta: Record<string, unknown> | null | undefined,
  opts?: { conversationState?: string | null }
): PendingBookingContext | null {
  if (!meta) return null;
  // STEP 10C: once the conversation is handed off to staff (emergency triage,
  // low-confidence handoff, or AI-outage fallback) the pending-booking
  // projection must stay quiet — a conversation awaiting a human must never
  // surface booking prefill/recommendations in the UI.
  const state = opts?.conversationState ?? null;
  if (state === 'awaiting_staff' || state === 'assigned_staff') return null;
  if (meta.handoff === true) return null;
  const booking = (meta.booking ?? {}) as Record<string, unknown>;
  const hasAnySignal = Boolean(
    meta.recommended_service_id || meta.recommended_provider_id || booking.slot
  );
  if (!hasAnySignal) return null;

  const recommended_service_id = (meta.recommended_service_id as string) ?? null;
  const recommended_provider_id = (meta.recommended_provider_id as string) ?? null;
  const service_id = (booking.service_id as string) ?? null;
  const provider_id = (booking.provider_id as string) ?? null;
  const patient_name = (booking.patient_name as string) ?? null;
  const phone = (booking.phone as string) ?? (booking.phone_number as string) ?? null;
  const email = (booking.email as string) ?? null;
  const slot = (booking.slot as string) ?? null;

  const missing = missingBookingFields({
    booking: {
      service_id,
      provider_id,
      slot,
      patient_name,
      phone,
    },
  });

  return {
    recommended_service_id,
    recommended_provider_id,
    conversation_state:
      (meta.state as string) || (meta.conversation_state_machine as string) || null,
    patient_name,
    patient_phone: phone,
    patient_email: email,
    booking_service_id: service_id,
    booking_provider_id: provider_id,
    slot,
    patient_confirmed_booking: Boolean(meta.patient_confirmed_booking),
    missing,
  };
}

/**
 * The exact shape ChatInterface leans on to apply the canonical context into
 * its local UI projection (single, typed source for the merge). Values that
 * the user has already typed/selected in the UI take precedence and are never
 * overwritten by a stale/less-authoritative server value.
 */
export type BookingUiProjection = {
  selectedService: string | null;
  selectedProvider: string | null;
  selectedDate: string | null;
  selectedSlot: string | null;
  showBookingSummary: boolean;
  patientName: string;
  patientPhone: string;
  patientEmail: string;
  bookingMode: boolean;
};

/**
 * Merges the canonical context into the current UI projection.
 * - Recommended ids drive service/provider prefill ONLY when unset.
 * - A REAL slot from the booking metadata drives selectedSlot/date prefill ONLY
 *   when the user hasn't already picked a slot; never invents one.
 * - Patient info fills the UI ONLY when the field is empty (user input wins).
 */
export function applyPendingBookingContext(
  ui: BookingUiProjection,
  ctx: PendingBookingContext | null
): BookingUiProjection {
  if (!ctx) return ui;
  const next: BookingUiProjection = { ...ui };

  if (!next.selectedService) {
    const id =
      ctx.booking_service_id ??
      ctx.recommended_service_id ??
      next.selectedService;
    if (id) next.selectedService = id;
  }
  if (!next.selectedProvider) {
    const id =
      ctx.booking_provider_id ??
      ctx.recommended_provider_id ??
      next.selectedProvider;
    if (id) next.selectedProvider = id;
  }
  // A REAL slot from the persisted presence — only when user hasn't chosen one.
  if (ctx.slot && !next.selectedSlot) {
    const date = ctx.slot.split('T')[0];
    next.selectedSlot = ctx.slot;
    if (date) next.selectedDate = date;
    next.showBookingSummary = true;
  }
  if (ctx.patient_name && !next.patientName) next.patientName = ctx.patient_name;
  if (ctx.patient_phone && !next.patientPhone) next.patientPhone = ctx.patient_phone;
  if (ctx.patient_email && !next.patientEmail) next.patientEmail = ctx.patient_email;
  if (ctx.conversation_state && !next.bookingMode) next.bookingMode = true;
  return next;
}