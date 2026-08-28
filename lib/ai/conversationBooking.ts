import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { findOrCreatePatient, createBooking, isValidBookingPhone } from '@/lib/services/bookingService';
import type { ClinicOperatingData } from './clinicDataContext';

/**
 * Conversational booking execution — completes a booking INSIDE the AI
 * conversation when (and only when) the state machine says:
 *   state === 'BOOKING' && patient_confirmed_booking
 * AND every required field (service, provider, patient name, phone, slot) is
 * already known.
 *
 * Safety:
 *  - Uses the existing `createBooking` (slot re-check + DB unique constraint),
 *    so concurrency is protected exactly like the public booking route.
 *  - Idempotent: if the conversation metadata already carries an
 *    appointment_id, it never creates a second appointment.
 *  - Clinic-scoped: ids are validated against THIS clinic by bookingService.
 *  - Never fabricates: if a required field is missing it returns
 *    `need_more_info` and the AI asks only for what is missing.
 *  - A non-tentative slot or any error degrades to `slot_unavailable` /
 *    `failed` → the AI offers alternatives or hands off.
 */

export type BookingAttemptResult =
  | { action: 'not_ready'; state: string }
  | { action: 'need_more_info'; missing: Array<'service' | 'provider' | 'patient_name' | 'phone' | 'slot'> }
  | { action: 'slot_unavailable'; reason: string }
  | { action: 'booked'; appointment: { id: string; scheduled_at: string; status: string } }
  | { action: 'already_booked'; appointment_id: string }
  | { action: 'failed'; reason: string };

export function missingBookingFields(state: {
  booking: { service_id: string | null; provider_id: string | null; slot: string | null; patient_name: string | null; phone: string | null };
}): Array<'service' | 'provider' | 'patient_name' | 'phone' | 'slot'> {
  const missing: Array<'service' | 'provider' | 'patient_name' | 'phone' | 'slot'> = [];
  if (!state.booking.service_id) missing.push('service');
  if (!state.booking.provider_id) missing.push('provider');
  if (!state.booking.patient_name || !state.booking.patient_name.trim()) missing.push('patient_name');
  if (!state.booking.phone || !state.booking.phone.trim()) missing.push('phone');
  if (!state.booking.slot) missing.push('slot');
  return missing;
}
export async function attemptConversationBooking(params: {
  clinicId: string;
  conversationId: string;
  state: string;
  patientConfirmedBooking: boolean;
  booking: { service_id: string | null; provider_id: string | null; slot: string | null; patient_name: string | null; phone: string | null; email?: string | null };
  operatingData: ClinicOperatingData;
}): Promise<BookingAttemptResult> {
  const { clinicId, conversationId, state, patientConfirmedBooking, booking, operatingData } = params;

  if (state !== 'BOOKING' || !patientConfirmedBooking) {
    return { action: 'not_ready', state };
  }

  // Idempotency guard: a booking already created for this conversation.
  try {
    const { data: meta } = await supabaseAdmin
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    const existingAppointmentId =
      (meta?.metadata as Record<string, unknown>)?.booking &&
      ((meta.metadata as Record<string, unknown>).booking as Record<string, unknown>).appointment_id;
    if (typeof existingAppointmentId === 'string' && existingAppointmentId) {
      return { action: 'already_booked', appointment_id: existingAppointmentId };
    }
  } catch {
    // Non-fatal: proceed, bookingService also guards duplicates via constraints.
  }

  const missing = missingBookingFields({ booking });
  if (missing.length > 0) {
    return { action: 'need_more_info', missing };
  }

  // Hard phone rule: an appointment may only be created once a VALID phone is
  // present. A malformed phone is treated as missing so the AI asks for it and
  // never reaches findOrCreatePatient / createBooking on this path either.
  if (!isValidBookingPhone(booking.phone)) {
    return { action: 'need_more_info', missing: ['phone'] };
  }

  // Verify recommended resources actually exist in THIS clinic before creating.
  const serviceExists = operatingData.services.some((s) => s.id === booking.service_id);
  const providerExists = operatingData.providers.some((p) => p.id === booking.provider_id);
  if (!serviceExists || !providerExists) {
    logEvent('conversation_booking_invalid_recommendation', {
      clinic_id: clinicId,
      conversation_id: conversationId,
      service_id: booking.service_id,
      provider_id: booking.provider_id,
    }, 'error');
    return { action: 'failed', reason: 'recommendation_out_of_clinic' };

}
  try {
    const patientId = await findOrCreatePatient({
      clinicId,
      name: (booking.patient_name as string).trim(),
      phone: booking.phone,
      email: booking.email ?? null,
    });

    const service = operatingData.services.find((s) => s.id === booking.service_id);
    const slot = booking.slot as string; // validated non-null above
    const [date, time] = parseSlot(slot);

    const created = await createBooking({
      clinicId,
      providerId: booking.provider_id as string,
      service: service?.name ?? 'Dental service',
      date,
      time,
      patientId,
      serviceId: service?.id,
      conversationId,
      durationMinutes: service?.duration_minutes ?? undefined,
    });

    logEvent('conversation_booking_created', {
      clinic_id: clinicId,
      conversation_id: conversationId,
      appointment_id: created.id,
      provider_id: booking.provider_id,
      service_id: service?.id ?? null,
    });
    return { action: 'booked', appointment: { id: created.id, scheduled_at: created.scheduled_at, status: created.status } };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (/Slot unavailable|concurrent booking/i.test(reason)) {
      return { action: 'slot_unavailable', reason };
    }
    logEvent('conversation_booking_failed', {
      clinic_id: clinicId,
      conversation_id: conversationId,
      error: reason,
    }, 'error');
    return { action: 'failed', reason };
  }
}

/** Parses a slot "YYYY-MM-DDTHH:MM:SS.000Z" (or "YYYY-MM-DDTHH:MM") into { date, time }. */
export function parseSlot(slot: string): [string, string] {
  const m = slot.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return [m[1], m[2]];
  const parts = slot.split(' ');
  const time = parts[parts.length - 1] || '10:00';
  const date = parts.length > 1 ? parts[0] : new Date().toISOString().slice(0, 10);
  return [date, time];
}