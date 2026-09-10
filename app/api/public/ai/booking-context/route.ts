import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { getConversationById } from '@/lib/services/conversationService';
import { persistReceptionistSlot } from '@/lib/ai/clinicDataContext';
import { getAvailableSlots } from '@/lib/services/bookingService';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/**
 * STEP 7 — Persist Booking UI selections INTO the canonical conversation state.
 *
 * This is the "Booking UI → Conversation/AI" direction. It relies on the SAME
 * canonical source (conversations.metadata.booking) and the SAME persistence
 * helper (persistReceptionistSlot) the orchestrator uses — no second state.
 *
 * Safety:
 *  - Closes over clinic ownership (IDOR) via getConversationById(conversation_id, clinic_id).
 *  - A slot is persisted ONLY if it comes from real availability (getAvailableSlots);
 *    the client can never write an invented slot through here.
 *  - No schema change, no new booking engine, no availability semantics change.
 */

const bodySchema = z.object({
  clinic_slug: z.string().min(1).max(200).optional(),
  clinic_id: z.string().uuid().optional(),
  conversation_id: z.string().min(1).max(256),
  service_id: z.string().uuid().optional(),
  provider_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slot: z.string().min(1).max(64).optional(),
  patient_name: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  confirmed: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const {
      clinic_slug,
      clinic_id,
      conversation_id,
      service_id,
      provider_id,
      date,
      slot: requestedSlot,
      patient_name,
      phone,
      email,
      confirmed,
    } = parsed.data;

    const clinic = await resolvePublicClinic({ id: clinic_id, slug: clinic_slug });
    if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });

    // IDOR guard — the conversation must belong to this clinic.
    const conv = await getConversationById(conversation_id, clinic.id).catch(() => null);
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
    }

    // Slot integrity: never persist an invented/new slot. If a slot is supplied
    // it MUST be a real availability slot for the given provider/date/service.
    if (requestedSlot) {
      if (!provider_id || !date) {
        // Cannot verify a slot without a provider + date — reject (no invented slot).
        return NextResponse.json({ error: 'provider_id and date required to verify a slot' }, { status: 400 });
      }
      const [start] = requestedSlot.split('T');
      const slotDate = start || date;
      const real = await getAvailableSlots(clinic.id, provider_id, slotDate, 100, service_id).catch(() => []);
      if (!real.includes(requestedSlot)) {
        return NextResponse.json({ error: 'Slot is not currently available' }, { status: 409 });
      }
    }

    // Persist into canonical conversation metadata via the existing helper.
    await persistReceptionistSlot(clinic.id, conversation_id, {
      ...(service_id ? { service_id } : {}),
      ...(provider_id ? { provider_id } : {}),
      ...(requestedSlot ? { slot: requestedSlot } : {}),
      ...(patient_name ? { patient_name } : {}),
      ...(phone !== undefined ? { phone: phone ?? null } : {}),
      ...(email !== undefined ? { email: email ?? null } : {}),
    });

    // Confirmation is also behind the existing state machine semantics: we only
    // record the flag (the orchestrator runs attemptConversationBooking only when
    // state==='BOOKING' && patient_confirmed_booking).
    if (confirmed) {
      await supabaseAdmin
        .from('conversations')
        .update({ metadata: { ...(conv.metadata ?? {}), patient_confirmed_booking: true } })
        .eq('id', conversation_id)
        .eq('clinic_id', clinic.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_context_save_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Failed to save booking context' }, { status: 500 });
  }
}