import { detectConversationIntelligence, type ConversationIntelligence, type ConversationState, type ConversationIntent } from '@/lib/ai/intelligence';
import { classifyIntent, SEMANTIC_INTENTS, type SemanticIntent } from '@/lib/ai/intentClassifier';
import { EMPTY_PATIENT_CONTEXT, loadPatientContext, savePatientContext, mergePatientContext, type PatientContext } from './patientContext';
import { createInitialState, transitionConversationState as transitConvoState, persistConversationState, loadConversationState, mapToLegacyConversationState, type ConversationStateDetail } from './conversationStateMachine';

export type IntelligenceClient = {
  from(table: string): any;
};

export const ANALYTICS_EVENTS = {
  conversationStarted: 'conversation_started',
  leadDetected: 'lead_detected',
  appointmentRequested: 'appointment_requested',
  appointmentBooked: 'appointment_booked',
  humanHandoff: 'human_handoff',
  conversationClosed: 'conversation_closed',
  conversationStateChanged: 'conversation_state_changed',
} as const;

export async function recordAnalyticsEvent(client: IntelligenceClient, event: {
  clinicId: string;
  conversationId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}) {
  const { error } = await client.from('ai_events').insert([{
    clinic_id: event.clinicId,
    conversation_id: event.conversationId ?? null,
    event_type: event.type,
    payload: event.payload ?? {},
  }]);
  if (error) throw error;
}

export async function recordAppointmentBooked(client: IntelligenceClient, params: {
  clinicId: string;
  conversationId: string;
  appointmentId?: string | null;
}) {
  await recordAnalyticsEvent(client, {
    clinicId: params.clinicId,
    conversationId: params.conversationId,
    type: ANALYTICS_EVENTS.appointmentBooked,
    payload: { appointment_id: params.appointmentId ?? null },
  });
}

export async function analyzeAndPersistMessage(client: IntelligenceClient, params: {
  clinicId: string;
  conversationId: string;
  text: string;
  confidenceThreshold?: number;
}): Promise<ConversationIntelligence> {
  // PRIMARY: LLM semantic classification (handles dialects, typos, phrasing).
  // FALLBACK: deterministic keyword rules for explicit actions / emergencies.
  const threshold = params.confidenceThreshold ?? 0.65;
  const semantic = await classifyIntent(params.text);

  // Map semantic intent list (14 intents) to the legacy ConversationIntent union.
  // The legacy keyword rules fill any gaps with entity extraction (appointment, contact).
  let semanticAsLegacy: ConversationIntent;
  switch (semantic.intent as SemanticIntent) {
    case SEMANTIC_INTENTS.GREETING: semanticAsLegacy = 'greeting'; break;
    case SEMANTIC_INTENTS.GENERAL_QUESTION: semanticAsLegacy = 'general_question'; break;
    case SEMANTIC_INTENTS.DENTAL_GENERAL_QUESTION: semanticAsLegacy = 'general_question'; break;
    case SEMANTIC_INTENTS.PATIENT_COMPLAINT: semanticAsLegacy = 'patient_complaint'; break;
    case SEMANTIC_INTENTS.CLINIC_INFORMATION:
    case SEMANTIC_INTENTS.SERVICE_INFORMATION:
    case SEMANTIC_INTENTS.PROVIDER_INFORMATION:
      semanticAsLegacy = 'services_inquiry'; break;
    case SEMANTIC_INTENTS.APPOINTMENT_BOOKING: semanticAsLegacy = 'appointment_booking'; break;
    case SEMANTIC_INTENTS.APPOINTMENT_CANCELLATION: semanticAsLegacy = 'appointment_cancellation'; break;
    case SEMANTIC_INTENTS.APPOINTMENT_RESCHEDULE: semanticAsLegacy = 'appointment_reschedule'; break;
    case SEMANTIC_INTENTS.HUMAN_HANDOFF: semanticAsLegacy = 'human_handoff'; break;
    case SEMANTIC_INTENTS.URGENT_SIGNAL: semanticAsLegacy = 'emergency'; break;
    case SEMANTIC_INTENTS.GOODBYE: semanticAsLegacy = 'goodbye'; break;
    default: semanticAsLegacy = 'unknown'; break;
  }

  // Use the LLM classifier output when it is confident enough.
  // Fall back to the keyword/lexical engine for entity extraction + legacy handling.
  let intelligence: ConversationIntelligence;
  if (semantic && semantic.confidence >= threshold) {
    intelligence = detectConversationIntelligence(params.text, threshold);
    // Override intent + confidence from the semantic classifier.
    intelligence = {
      ...intelligence,
      intent: semanticAsLegacy,
      confidence: semantic.confidence,
      // Keep severity from semantic entities if present
      urgency: semantic.entities?.urgency === 'critical'
        ? 'critical'
        : semantic.entities?.urgency === 'high'
          ? 'high'
          : intelligence.urgency,
      shouldHandoff: semanticAsLegacy === 'human_handoff' || semanticAsLegacy === 'emergency' || (semanticAsLegacy !== 'unknown' && semanticAsLegacy !== 'greeting' && semanticAsLegacy !== 'goodbye' && semanticAsLegacy !== 'general_question' && semanticAsLegacy !== 'patient_complaint' && semantic.confidence < threshold),
      appointment: {
        ...intelligence.appointment,
        requestedService: semantic.entities?.requested_service ?? intelligence.appointment?.requestedService ?? null,
        preferredTime: semantic.entities?.time ?? intelligence.appointment?.preferredTime ?? null,
      },
    };
  } else {
    intelligence = detectConversationIntelligence(params.text, threshold);
  }

  // --- Conversation engine: patient context + state machine ---
  // Load existing patient context, update it from the current message's entities,
  // then run the deterministic state machine (never jumps to booking prematurely).
  let patientContext: PatientContext = EMPTY_PATIENT_CONTEXT;
  let convoState: ConversationStateDetail;
  try {
    // Use the anon/cli client passed in (it's supabaseAdmin in production).
    const loader = (client as any).from ? client : null;
    // Prefer the provided client for consistency.
    const existingCtx = await loadPatientContext(params.conversationId, params.clinicId);
    patientContext = mergePatientContext(existingCtx, {
      problem: (semantic.entities?.problem as string) || (intelligence.appointment?.requestedService as string) || existingCtx.problem,
      duration: (semantic.entities?.duration as string) || existingCtx.duration,
      trigger: (semantic.entities?.trigger as string) || existingCtx.trigger,
      urgency: ((semantic.entities?.urgency as PatientContext['urgency']) || existingCtx.urgency || (intelligence.urgency === 'critical' ? 'critical' : intelligence.urgency)),
      requested_need: (semantic.entities?.requested_service as string) || (intelligence.appointment?.requestedService as string) || existingCtx.requested_need,
    });

    const fallback = createInitialState(patientContext);
    convoState = await loadConversationState(params.clinicId, params.conversationId, fallback);
    convoState = transitConvoState({
      intent: semantic.intent,
      patientText: params.text,
      current: convoState,
      hasUrgentSignal: semantic.intent === SEMANTIC_INTENTS.URGENT_SIGNAL || intelligence.urgency === 'critical',
      patientRequestsHuman: semantic.intent === SEMANTIC_INTENTS.HUMAN_HANDOFF,
    });
    convoState.context = patientContext;
  } catch (ctxErr) {
    // Don't let context/state failures break the core AI response.
    convoState = createInitialState(patientContext);
    convoState.context = patientContext;
  }

  const metadata = {
    intelligence: {
      intent: intelligence.intent,
      confidence: intelligence.confidence,
      urgency: intelligence.urgency,
      appointment: intelligence.appointment,
      updated_at: new Date().toISOString(),
      semantic: { intent: semantic.intent, confidence: semantic.confidence, entities: semantic.entities },
    },
    conversation_state_machine: convoState.state,
    subject_analysis: patientContext,
  };

  const { error: conversationError } = await client.from('conversations')
    .update({
      conversation_state: mapToLegacyConversationState(convoState.state),
      intent: intelligence.intent,
      intent_confidence: intelligence.confidence,
      urgency: intelligence.urgency,
      appointment_data: intelligence.appointment,
      metadata,
    })
    .eq('id', params.conversationId)
    .eq('clinic_id', params.clinicId);
  if (conversationError) throw conversationError;

  // Persist patient context + state machine (best-effort, don't block response).
  try {
    await savePatientContext(params.conversationId, params.clinicId, patientContext, {
      conversation_state_machine: convoState.state,
    });
    await persistConversationState(params.clinicId, params.conversationId, convoState);
  } catch (ctxErr) {
    // Non-fatal — the in-memory metadata above is already persisted.
  }

  if (intelligence.lead.temperature !== 'cold') {
    const { error } = await client.from('ai_leads').insert([{
      clinic_id: params.clinicId,
      conversation_id: params.conversationId,
      patient_contact: intelligence.appointment,
      score: intelligence.lead.confidence,
      lead_temperature: intelligence.lead.temperature,
      intent: intelligence.intent,
      urgency: intelligence.urgency,
      estimated_value: intelligence.lead.estimatedValue,
      confidence: intelligence.lead.confidence,
      metadata: { source: 'conversation_intelligence' },
    }]);
    if (error) throw error;
    await recordAnalyticsEvent(client, { clinicId: params.clinicId, conversationId: params.conversationId, type: ANALYTICS_EVENTS.leadDetected, payload: intelligence.lead });
  }

  if (intelligence.intent === 'appointment_booking' || intelligence.intent === 'appointment_reschedule') {
    await recordAnalyticsEvent(client, { clinicId: params.clinicId, conversationId: params.conversationId, type: ANALYTICS_EVENTS.appointmentRequested, payload: intelligence.appointment });
  }
  if (intelligence.shouldHandoff) {
    await recordAnalyticsEvent(client, { clinicId: params.clinicId, conversationId: params.conversationId, type: ANALYTICS_EVENTS.humanHandoff, payload: { reason: intelligence.intent, confidence: intelligence.confidence } });
  }

  return intelligence;
}

export async function transitionConversationState(client: IntelligenceClient, params: {
  clinicId: string;
  conversationId: string;
  state: ConversationState;
  staffId?: string | null;
}) {
  const values: Record<string, unknown> = { conversation_state: params.state };
  if (params.state === 'assigned_staff') values.assigned_staff_id = params.staffId ?? null;
  if (params.state === 'closed' || params.state === 'resolved') values.ended_at = new Date().toISOString();
  const { data, error } = await client.from('conversations').update(values)
    .eq('id', params.conversationId).eq('clinic_id', params.clinicId).select('*').single();
  if (error) throw error;
  if (params.state === 'closed') {
    await recordAnalyticsEvent(client, { clinicId: params.clinicId, conversationId: params.conversationId, type: ANALYTICS_EVENTS.conversationClosed });
  }
  return data;
}
