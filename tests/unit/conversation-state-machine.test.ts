import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STATES,
  createInitialState,
  transitionConversationState,
  type ConversationStateDetail,
} from '@/lib/services/conversationStateMachine';
import { EMPTY_PATIENT_CONTEXT } from '@/lib/services/patientContext';

function stateWithProblem(ctxOver = {}): ConversationStateDetail {
  const s = createInitialState({ ...EMPTY_PATIENT_CONTEXT, problem: 'ألم في الطاحونة', ...ctxOver });
  s.state = CONVERSATION_STATES.DISCOVERING_PROBLEM;
  return s;
}

describe('Conversation State Machine (deterministic — no LLM required)', () => {
  it('patient_complaint NEVER jumps to BOOKING', () => {
    const start = createInitialState({ ...EMPTY_PATIENT_CONTEXT, problem: '' });
    const next = transitionConversationState({
      intent: 'patient_complaint',
      patientText: 'طاحونتي بتجعني',
      current: start,
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).not.toBe(CONVERSATION_STATES.BOOKING);
    expect(next.state).not.toBe(CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION);
    expect(next.state).toBe(CONVERSATION_STATES.DISCOVERING_PROBLEM);
  });

  it('booking intent with NO identified problem still goes to DISCOVERING_PROBLEM (conversation first)', () => {
    const start = createInitialState({ ...EMPTY_PATIENT_CONTEXT, problem: '' });
    const next = transitionConversationState({
      intent: 'appointment_booking',
      patientText: 'بدي أحجز',
      current: start,
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.DISCOVERING_PROBLEM);
    expect(next.pending_question.length).toBeGreaterThan(0);
  });

  it('booking intent with recommended provider → AWAITING_BOOKING_CONFIRMATION (NOT BOOKING yet)', () => {
    const current = stateWithProblem({ likely_specialty: 'زراعة' });
    current.recommended_service_id = 'svc-implant';
    current.recommended_provider_id = 'prov-1';
    const next = transitionConversationState({
      intent: 'appointment_booking',
      patientText: 'بدي أحجز',
      current,
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION);
    expect(next.patient_confirmed_booking).toBe(false);
  });

  it('booking intent without a valid service/provider recommendation stays in discovery', () => {
    const current = stateWithProblem();
    const next = transitionConversationState({
      intent: 'appointment_booking',
      patientText: 'بدي موعد',
      current,
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.DISCOVERING_PROBLEM);
    expect(next.state).not.toBe(CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION);
  });

  it('explicit confirmation ("نعم احجز") moves to BOOKING only from AWAITING_BOOKING_CONFIRMATION', () => {
    const current = stateWithProblem({ likely_specialty: 'زراعة' });
    current.state = CONVERSATION_STATES.AWAITING_BOOKING_CONFIRMATION;
    current.recommended_service_id = 'svc-implant';
    const next = transitionConversationState({
      intent: 'unknown',
      patientText: 'آه احجزلي',
      current,
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.patient_confirmed_booking).toBe(true);
    expect(next.state).toBe(CONVERSATION_STATES.BOOKING);
  });

  it('complaint in COLLECTING_INFORMATION stays conversational', () => {
    const current = stateWithProblem();
    current.state = CONVERSATION_STATES.COLLECTING_INFORMATION;
    const next = transitionConversationState({
      intent: 'patient_complaint',
      patientText: 'وبزيد مع البارد',
      current,
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.COLLECTING_INFORMATION);
  });

  it('urgent signal forces ASSESSING_URGENCY and handoff when requested', () => {
    let next = transitionConversationState({
      intent: 'urgent_signal',
      patientText: 'عندي صعوبة بالتنفس',
      current: stateWithProblem(),
      hasUrgentSignal: true,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.ASSESSING_URGENCY);

    next = transitionConversationState({
      intent: 'urgent_signal',
      patientText: 'بدي حدا من العيادة',
      current: stateWithProblem(),
      hasUrgentSignal: true,
      patientRequestsHuman: true,
    });
    expect(next.state).toBe(CONVERSATION_STATES.HUMAN_HANDOFF);
  });

  it('explicit human handoff moves to HUMAN_HANDOFF', () => {
    const next = transitionConversationState({
      intent: 'human_handoff',
      patientText: 'بدي أحكي مع موظفة',
      current: stateWithProblem(),
      hasUrgentSignal: false,
      patientRequestsHuman: true,
    });
    expect(next.state).toBe(CONVERSATION_STATES.HUMAN_HANDOFF);
  });

  it('default (unknown/greeting) does not move to booking', () => {
    let next = transitionConversationState({
      intent: 'greeting',
      patientText: 'مرحبا',
      current: stateWithProblem(),
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.DISCOVERING_PROBLEM);

    next = transitionConversationState({
      intent: 'unknown',
      patientText: 'شو أعمل؟',
      current: createInitialState({ ...EMPTY_PATIENT_CONTEXT }),
      hasUrgentSignal: false,
      patientRequestsHuman: false,
    });
    expect(next.state).toBe(CONVERSATION_STATES.INITIAL);
  });
});
