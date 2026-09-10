import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { getConversationById, updateConversationState } from '@/lib/services/conversationService';
import { notifyStaffForHandoff } from '@/lib/services/notificationService';
import { persistHandoffReply } from '@/lib/ai/handoffMessages';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { RateLimiter, getClientId } from '@/lib/services/gateway/security/rate-limiter';
import { logEvent } from '@/lib/server/logging';

const bodySchema = z.object({
  clinic_slug: z.string().min(1).max(200).optional(),
  clinic_id: z.string().uuid().optional(),
  conversation_id: z.string().min(1).max(256),
});

// Patient-initiated handoff is state-changing (flips conversation to the staff
// lane + creates a notification) — stricter than chat reads: 5 / minute / IP.
const handoffLimiter = new RateLimiter(5, 60_000);

/**
 * PHASE M — explicit "talk to a human" handoff requested by the patient.
 * Mirrors the AI-triggered handoff path (orchestrator → awaiting_staff +
 * staff notification + persisted reply) so both entry points behave
 * identically and the transcript always shows what the patient was told.
 */
export async function POST(req: Request) {
  if (!handoffLimiter.isAllowed(getClientId(req))) {
    return new NextResponse(
      JSON.stringify({ error: 'طلبات كثيرة. انتظر قليلاً ثم أعد المحاولة.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'معطيات غير صالحة' }, { status: 400 });
    }
    const { conversation_id: conversationId, clinic_slug: clinicSlug, clinic_id: clinicIdParam } = parsed.data;
    if (!clinicSlug && !clinicIdParam) {
      return NextResponse.json({ error: 'clinic identifier required' }, { status: 400 });
    }

    const clinic = await resolvePublicClinic({ id: clinicIdParam ?? undefined, slug: clinicSlug ?? undefined });
    if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });

    // IDOR guard: the conversation must belong to the resolved clinic.
    const conversation = await getConversationById(conversationId, clinic.id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
    }

    await updateConversationState(conversationId, 'awaiting_staff', clinic.id);
    try {
      await notifyStaffForHandoff(clinic.id, conversationId);
    } catch (notifyError) {
      // Notification failure must not fail the handoff itself — the state
      // flip + persisted reply already happened and the staff inbox lists
      // awaiting_human conversations prominently.
      logEvent('handoff_notify_failed', {
        clinic_id: clinic.id,
        conversation_id: conversationId,
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      }, 'warn');
    }
    const reply = await persistHandoffReply({
      supabase: supabaseAdmin,
      clinicId: clinic.id,
      conversationId,
      intent: 'human_handoff_request',
    });
    logEvent('patient_requested_handoff', { clinic_id: clinic.id, conversation_id: conversationId });
    return NextResponse.json({ data: { reply: reply.content } });
  } catch (err) {
    logEvent('public_handoff_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'تعذر تنفيذ التحويل الآن. حاول مرة أخرى.' }, { status: 500 });
  }
}