import { logEvent } from '@/lib/server/logging';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getConversationById } from './conversationService';

/**
 * Human-handoff staff summary (Phase 13).
 *
 * ROOT-CAUSE FIX: the handoff notification used to carry ONLY the
 * conversation_id — staff started from zero and had to dig through the
 * dashboard to understand why a patient needed help. The payload now carries
 * a structured summary built exclusively from REAL database rows (never
 * invented): patient identity, problem/symptoms, urgency, requested
 * service/provider, appointment status, the handoff reason and a short
 * transcript excerpt.
 */

export type HandoffSummary = {
  conversation_id: string;
  reason: string;
  urgency: string | null;
  intent: string | null;
  patient: {
    id: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  problem: string | null;
  symptoms: {
    duration: string | null;
    trigger: string | null;
    swelling: boolean | null;
    fever: boolean | null;
    bleeding: boolean | null;
    trauma: boolean | null;
  };
  requested: {
    service: string | null;
    service_id: string | null;
    provider: string | null;
    provider_id: string | null;
  };
  appointment_status: string | null;
  transcript_excerpt: Array<{ role: string; content: string }>;
};

/** Extracts a HandoffSummary from raw DB rows. Pure + unit-testable. */
export function buildHandoffSummary(params: {
  conversationId: string;
  conversation: {
    intent?: string | null;
    urgency?: string | null;
    patient_id?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  patient?: { full_name?: string | null; phone_number?: string | null; email?: string | null } | null;
  messages?: Array<{ role: string; content: string }> | null;
}): HandoffSummary {
  const meta = (params.conversation.metadata ?? {}) as Record<string, unknown>;
  const subject = (meta.subject_analysis ?? {}) as Record<string, unknown>;
  const bookingMeta = (meta.booking ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

  // Transcript excerpt: last 6 messages, chronological.
  const allMessages = params.messages ?? [];
  const excerpt = allMessages.slice(-6).map((m) => ({ role: m.role, content: m.content }));

  return {
    conversation_id: params.conversationId,
    reason: str(meta.handoff_reason) ?? (params.conversation.intent === 'emergency' ? 'emergency' : 'human_handoff_requested'),
    urgency: str(params.conversation.urgency) ?? str(subject.urgency),
    intent: str(params.conversation.intent),
    patient: {
      id: str(params.conversation.patient_id),
      name: str(params.patient?.full_name) ?? str(bookingMeta.patient_name) ?? str(subject.name),
      phone: str(params.patient?.phone_number) ?? str(bookingMeta.phone),
      email: str(params.patient?.email) ?? str(bookingMeta.email),
    },
    problem: str(subject.problem),
    symptoms: {
      duration: str(subject.duration),
      trigger: str(subject.trigger),
      swelling: bool(subject.swelling),
      fever: bool(subject.fever),
      bleeding: bool(subject.bleeding),
      trauma: bool(subject.trauma),
    },
    requested: {
      service: str(meta.recommended_service_name) ?? str(subject.recommended_service),
      service_id: str(meta.recommended_service_id) ?? str(bookingMeta.service_id),
      provider: str(meta.recommended_provider_name) ?? str(subject.recommended_provider),
      provider_id: str(meta.recommended_provider_id) ?? str(bookingMeta.provider_id),
    },
    appointment_status: str(bookingMeta.status),
    transcript_excerpt: excerpt,
  };
}
const TRANSCRIPT_EXCERPT_LIMIT = 12;

/**
 * Notifies clinic staff that a conversation requires their attention.
 * Creates a persistent notification record carrying a FULL structured
 * summary so staff never start from zero. Enrichment lookups are
 * best-effort: a failure only leaves that summary part empty, never
 * fails the handoff itself.
 */
export async function notifyStaffForHandoff(clinicId: string, conversationId: string): Promise<void> {
  // Fetch conversation details (clinic-scoped — throws when not found).
  const conversation = await getConversationById(conversationId, clinicId);
  if (!conversation) {
    throw new Error('Conversation not found for this clinic');
  }

  let patient: { full_name?: string | null; phone_number?: string | null; email?: string | null } | null = null;
  if (conversation.patient_id) {
    try {
      const { data } = await supabaseAdmin
        .from('patients')
        .select('full_name, phone_number, email')
        .eq('clinic_id', clinicId)
        .eq('id', conversation.patient_id)
        .is('deleted_at', null)
        .maybeSingle();
      patient = data ?? null;
    } catch (err) {
      logEvent('handoff_summary_patient_load_failed', { clinic_id: clinicId, conversation_id: conversationId, error: err instanceof Error ? err.message : String(err) }, 'warn');
    }
  }

  let messages: Array<{ role: string; content: string }> | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(TRANSCRIPT_EXCERPT_LIMIT);
    messages = ((data ?? []) as Array<{ role: string; content: string }>).reverse();
  } catch (err) {
    logEvent('handoff_summary_messages_load_failed', { clinic_id: clinicId, conversation_id: conversationId, error: err instanceof Error ? err.message : String(err) }, 'warn');
  }

  const summary = buildHandoffSummary({
    conversationId,
    conversation: conversation as any,
    patient,
    messages,
  });

  // Create a persistent notification record with the full staff summary.
  const { error } = await supabaseAdmin.from('notifications').insert({
    clinic_id: clinicId,
    user_id: null, // For now, we don't know which specific staff to notify. This can be extended.
    patient_id: conversation.patient_id,
    channel: 'email', // Default channel for handoff, can be configurable
    type: 'system', // notification_type enum only allows appointment_reminder, billing, system
    payload: summary as unknown as Record<string, unknown>,
    status: 'pending',
  });

  if (error) {
    logEvent('notification_persistence_error', { clinic_id: clinicId, conversation_id: conversationId, error: error.message }, 'error');
    throw new Error(`Failed to persist handoff notification: ${error.message}`);
  }

  logEvent('staff_notification_triggered', {
    clinic_id: clinicId,
    conversation_id: conversationId,
    reason: summary.reason,
    urgency: summary.urgency,
    has_summary: true,
  });
}
