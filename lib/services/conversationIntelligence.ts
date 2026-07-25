import { detectConversationIntelligence, type ConversationIntelligence, type ConversationState } from '@/lib/ai/intelligence';

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
  const intelligence = detectConversationIntelligence(params.text, params.confidenceThreshold ?? 0.65);
  const metadata = {
    intelligence: {
      intent: intelligence.intent,
      confidence: intelligence.confidence,
      urgency: intelligence.urgency,
      appointment: intelligence.appointment,
      updated_at: new Date().toISOString(),
    },
  };

  const { error: conversationError } = await client.from('conversations')
    .update({
      conversation_state: intelligence.state,
      intent: intelligence.intent,
      intent_confidence: intelligence.confidence,
      urgency: intelligence.urgency,
      appointment_data: intelligence.appointment,
      metadata,
    })
    .eq('id', params.conversationId)
    .eq('clinic_id', params.clinicId);
  if (conversationError) throw conversationError;

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
