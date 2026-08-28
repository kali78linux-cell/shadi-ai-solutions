import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import type { PatientContext } from './patientContext';

/**
 * Conversation State Machine for the dental AI receptionist.
 *
 * The machine must NEVER jump to BOOKING merely because intent=booking.
 * Booking only happens after the patient agrees to book (AWAITING_BOOKING_CONFIRMATION → BOOKING).
 */
export const CONVERSATION_STATES = {
  INITIAL: 'INITIAL',
  DISCOVERING_PROBLEM: 'DISCOVERING_PROBLEM',
  COLLECTING_INFORMATION: 'COLLECTING_INFORMATION',
  ASSESSING_URGENCY: 'ASSESSING_URGENCY',
  IDENTIFYING_NEED: 'IDENTIFYING_NEED',
  RECOMMENDING_PROVIDER: 'RECOMMENDING_PROVIDER',
  AWAITING_BOOKING_CONFIRMATION: 'AWAITING_BOOKING_CONFIRMATION',
  BOOKING: 'BOOKING',
  COMPLETED: 'COMPLETED',
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
} as const;

export type ConversationStateName = (typeof CONVERSATION_STATES)[keyof typeof CONVERSATION_STATES];

export type ConversationStateDetail = {
  state: ConversationStateName;
  context: PatientContext;
  /** The last AI question asked, so the next turn can respond contextually. */
  pending_question: string;
  /** True when the AI has asked enough follow-up questions and is ready to recommend. */
  ready_for_recommendation: boolean;
  /** The recommended service id (only after need identified). */
  recommended_service_id: string | null;
  /** The recommended provider id (only after provider reasoning). */
  recommended_provider_id: string | null;
  /** True when the patient has explicitly agreed to book. */
  patient_confirmed_booking: boolean;
  /** Booking context (service/provider/date/time/patient data) accumulated during BOOKING. */
  booking: {
    service_id: string | null;
    provider_id: string | null;
    slot: string | null;
    patient_name: string | null;
    phone: string | null;
    email: string | null;
  };
};

export function createInitialState(context: PatientContext): ConversationStateDetail {
  return {
    state: CONVERSATION_STATES.INITIAL,
    context,
    pending_question: '',
    ready_for_recommendation: false,
    recommended_service_id: null,
    recommended_provider_id: null,
    patient_confirmed_booking: false,
    booking: {
      service_id: null,
      provider_id: null,
      slot: null,
      patient_name: null,
      phone: null,
      email: null,
    },
  };
}

export type StateTransitionInput = {
  intent: string;
  patientText: string;
  current: ConversationStateDetail;
  hasUrgentSignal: boolean;
  patientRequestsHuman: boolean;
};

/**
 * Deterministic state transition rules.
 *
 * Primary driver = intent classification via LLM, but the STATE stays
 * conversational until the patient explicitly confirms booking.
 */
export function transitionConversationState(input: StateTransitionInput): ConversationStateDetail {
  const { intent, current, hasUrgentSignal, patientRequestsHuman, patientText } = input;

  const next = {
    ...current,
    context: { ...current.context },
    booking: { ...current.booking },
  };

  // URGENT always wins → ASSESSING_URGENCY → HUMAN_HANDOFF
  if (hasUrgentSignal) {
    next.state = CONVERSATION_STATES.ASSESSING_URGENCY;
    next.pending_question = '';
    if (patientRequestsHuman) {
      next.state = CONVERSATION_STATES.HUMAN_HANDOFF;
    }
    return next;
  }

  // Human handoff explicit request
  if (patientRequestsHuman || intent === 'human_handoff') {
    next.state = CONVERSATION_STATES.HUMAN_HANDOFF;
    next.pending_question = '';
    return next;
  }

  // Patient complaint → collect information, NOT booking
  if (intent === 'patient_complaint') {
    if (current.state === CONVERSATION_STATES.INITIAL || current.state === CONVERSATION_STATES.DISCOVERING_PROBLEM) {
      next.state = CONVERSATION_STATES.DISCOVERING_PROBLEM;
    } else if (current.state === CONVERSATION_STATES.COLLECTING_INFORMATION) {
      next.state = CONVERSATION_STATES.COLLECTING_INFORMATION;
    } else if (current.state === CONVERSATION_STATES.ASSESSING_URGENCY) {
      next.state = CONVERSATION_STATES.ASSESSING_URGENCY;
    }
    return next;
  }

  // Patient explicitly confirms booking after a recommendation
  // ("آه احجزلي", "نعم احجز", "تمام", …). This must fire BEFORE any
  // intent-based early return — even if the classifier labels it "unknown",
  // the state is AWAITING_BOOKING_CONFIRMATION and the patient confirmed.
  if (current.state === CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION
      && patientText
      && /احجز|تأكد|آه|نعم|تمام|اوكي|يس|yeah|yes|ok|بالتأكيد|موافق|أكيد/i.test(patientText)) {
    next.patient_confirmed_booking = true;
    next.state = CONVERSATION_STATES.BOOKING;
    return next;
  }

  // Greeting/general/unknown → stay conversational
  if (intent === 'greeting' || intent === 'general_question' || intent === 'dental_general_question' || intent === 'unknown' || intent === 'goodbye') {
    if (current.state === CONVERSATION_STATES.INITIAL) {
      next.state = CONVERSATION_STATES.INITIAL;
    }
    return next;
  }

  // Booking intent does NOT immediately open the booking form.
  // If we haven't yet understood the problem, go discover the problem first.
  if (intent === 'appointment_booking') {
    const hasProblem = next.context.problem && next.context.problem.length > 1;
    const hasIdentifiedNeed = next.context.recommended_service || next.context.likely_specialty;
    const hasRecommended = next.recommended_service_id || next.recommended_provider_id;

    if (!hasProblem || (!hasIdentifiedNeed && !hasRecommended)) {
      next.state = CONVERSATION_STATES.DISCOVERING_PROBLEM;
      next.pending_question = 'أكيد. قبل ماأساعدك بالحجز، ممكن تحكيلي شو المشكلة بالضبط؟'; // We'll let the LLM phrase this
      return next;
    }

    if (hasRecommended && !next.patient_confirmed_booking) {
      next.state = CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION;
      return next;
    }

    if (next.patient_confirmed_booking) {
      next.state = CONVERSATION_STATES.BOOKING;
    }
    return next;
  }

  // Cancellation / reschedule → still conversational first; don't jump to booking UI
  if (intent === 'appointment_cancellation' || intent === 'appointment_reschedule') {
    next.state = CONVERSATION_STATES.DISCOVERING_PROBLEM;
    next.pending_question = 'بدي أفهم شو المطلوب بالضبط: هل تريد إلغاء موعدك، أو تغييره؟';
    return next;
  }

  // Default: stay where we are; never accidentally show booking.
  return next;
}

/**
 * Maps the conversational state machine state to the legacy
 * `conversations.conversation_state` enum column ('ai','awaiting_staff',
 * 'assigned_staff','resolved','closed'). The detailed state machine stays
 * in metadata; the DB enum column only holds the legacy coarse values.
 */
export function mapToLegacyConversationState(state: ConversationStateName): 'ai' | 'awaiting_staff' | 'assigned_staff' | 'resolved' | 'closed' {
  switch (state) {
    case CONVERSATION_STATES.HUMAN_HANDOFF: return 'awaiting_staff';
    case CONVERSATION_STATES.COMPLETED: return 'resolved';
    default: return 'ai'; // all conversational/intake/booking stages stay under AI control
  }
}

export async function persistConversationState(
  clinicId: string,
  conversationId: string,
  state: ConversationStateDetail
): Promise<void> {
  // State persistence shares `conversations.metadata` with PatientContext and
  // conversation intelligence. Read the existing object first so this update
  // never discards subject_analysis or future metadata fields.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (existingError) {
    logEvent('conversation_state_metadata_load_failed', { clinic_id: clinicId, conversation_id: conversationId, error: existingError.message }, 'error');
    return;
  }

  const existingMetadata = (existing?.metadata ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from('conversations')
    .update({
      conversation_state: mapToLegacyConversationState(state.state),
      metadata: {
        ...existingMetadata,
        ...state,
        updated_at: new Date().toISOString(),
      },
    })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId);
  if (error) {
    logEvent('conversation_state_persist_failed', { clinic_id: clinicId, conversation_id: conversationId, error: error.message }, 'error');
  }
}

export async function loadConversationState(
  clinicId: string,
  conversationId: string,
  fallback: ConversationStateDetail
): Promise<ConversationStateDetail> {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('metadata, conversation_state')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error || !data?.metadata) {
      return fallback;
    }
    const rawMeta = (data.metadata ?? {}) as Record<string, unknown>;
    const savedState = (rawMeta.state as string) || '';
    const validStates: string[] = [
      CONVERSATION_STATES.INITIAL,
      CONVERSATION_STATES.DISCOVERING_PROBLEM,
      CONVERSATION_STATES.COLLECTING_INFORMATION,
      CONVERSATION_STATES.ASSESSING_URGENCY,
      CONVERSATION_STATES.IDENTIFYING_NEED,
      CONVERSATION_STATES.RECOMMENDING_PROVIDER,
      CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION,
      CONVERSATION_STATES.BOOKING,
      CONVERSATION_STATES.COMPLETED,
      CONVERSATION_STATES.HUMAN_HANDOFF,
    ];
    const state = validStates.includes(savedState)
      ? (savedState as ConversationStateName)
      : fallback.state;

    return {
      ...fallback,
      ...(rawMeta as Partial<ConversationStateDetail>),
      context: (rawMeta.context as PatientContext) ?? fallback.context,
      booking: (rawMeta.booking as ConversationStateDetail['booking']) ?? fallback.booking,
      state,
    };
  } catch {
    return fallback;
  }
}
