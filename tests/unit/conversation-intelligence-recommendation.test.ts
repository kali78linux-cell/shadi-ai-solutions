import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  classifyIntent: vi.fn(),
  detectConversationIntelligence: vi.fn(),
  loadPatientContext: vi.fn(),
  savePatientContext: vi.fn(),
  mergePatientContext: vi.fn(),
  createInitialState: vi.fn(),
  loadConversationState: vi.fn(),
  transitionConversationState: vi.fn(),
  persistConversationState: vi.fn(),
  mapToLegacyConversationState: vi.fn(),
  reasonServiceProvider: vi.fn(),
}));

vi.mock('@/lib/ai/intentClassifier', () => ({
  SEMANTIC_INTENTS: { GREETING: 'greeting', GENERAL_QUESTION: 'general_question', DENTAL_GENERAL_QUESTION: 'dental_general_question', PATIENT_COMPLAINT: 'patient_complaint', CLINIC_INFORMATION: 'clinic_information', SERVICE_INFORMATION: 'service_information', PROVIDER_INFORMATION: 'provider_information', APPOINTMENT_BOOKING: 'appointment_booking', APPOINTMENT_CANCELLATION: 'appointment_cancellation', APPOINTMENT_RESCHEDULE: 'appointment_reschedule', HUMAN_HANDOFF: 'human_handoff', URGENT_SIGNAL: 'urgent_signal', GOODBYE: 'goodbye', UNKNOWN: 'unknown' },
  classifyIntent: mocks.classifyIntent,
}));
vi.mock('@/lib/ai/intelligence', () => ({ detectConversationIntelligence: mocks.detectConversationIntelligence }));
vi.mock('@/lib/services/patientContext', () => ({
  EMPTY_PATIENT_CONTEXT: { problem: '', requested_need: '', likely_specialty: '', recommended_service: '', recommended_provider: '' },
  loadPatientContext: mocks.loadPatientContext,
  savePatientContext: mocks.savePatientContext,
  mergePatientContext: mocks.mergePatientContext,
}));
vi.mock('@/lib/services/conversationStateMachine', () => ({
  createInitialState: mocks.createInitialState,
  loadConversationState: mocks.loadConversationState,
  transitionConversationState: mocks.transitionConversationState,
  persistConversationState: mocks.persistConversationState,
  mapToLegacyConversationState: mocks.mapToLegacyConversationState,
}));
vi.mock('@/lib/services/receptionistReasoning', () => ({ reasonServiceProvider: mocks.reasonServiceProvider }));

import { analyzeAndPersistMessage } from '@/lib/services/conversationIntelligence';

const clinicId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';

function state() {
  return {
    state: 'DISCOVERING_PROBLEM',
    context: {},
    pending_question: '',
    ready_for_recommendation: false,
    recommended_service_id: null,
    recommended_provider_id: null,
    patient_confirmed_booking: false,
    booking: {},
  };
}

describe('conversation intelligence recommendation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classifyIntent.mockResolvedValue({ intent: 'patient_complaint', confidence: 0.9, entities: { problem: 'ألم في ضرس', trigger: 'البارد' } });
    mocks.detectConversationIntelligence.mockReturnValue({ intent: 'patient_complaint', confidence: 0.9, urgency: 'normal', shouldHandoff: false, appointment: {}, lead: { temperature: 'cold' } });
    mocks.loadPatientContext.mockResolvedValue({ problem: '', requested_need: '', likely_specialty: '', recommended_service: '', recommended_provider: '' });
    mocks.mergePatientContext.mockImplementation((existing, incoming) => ({ ...existing, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== '')) }));
    mocks.createInitialState.mockImplementation((context) => ({ ...state(), context }));
    mocks.loadConversationState.mockImplementation(async (_clinic, _conversation, fallback) => fallback);
    mocks.transitionConversationState.mockImplementation((input) => input.current);
    mocks.mapToLegacyConversationState.mockReturnValue('ai');
    mocks.savePatientContext.mockResolvedValue(undefined);
    mocks.persistConversationState.mockResolvedValue(undefined);
  });

  it('passes PatientContext to clinic-scoped reasoning and persists valid recommendation IDs', async () => {
    mocks.reasonServiceProvider.mockResolvedValue({
      recommendedServiceId: 'service-a', recommendedServiceName: 'فحص أسنان',
      recommendedProviderId: 'provider-a', recommendedProviderName: 'د. أ', candidates: [], multipleProviders: false,
    });
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) }));
    const client = { from: vi.fn(() => ({ update })) };

    await analyzeAndPersistMessage(client as any, { clinicId, conversationId, text: 'عندي ألم في ضرس' });

    expect(mocks.reasonServiceProvider).toHaveBeenCalledWith(clinicId, expect.objectContaining({ problem: 'ألم في ضرس' }));
    expect(mocks.persistConversationState).toHaveBeenCalledWith(clinicId, conversationId, expect.objectContaining({
      state: 'RECOMMENDING_PROVIDER',
      recommended_service_id: 'service-a',
      recommended_provider_id: 'provider-a',
      context: expect.objectContaining({ recommended_service: 'فحص أسنان', recommended_provider: 'د. أ' }),
    }));
  });

  it('does not enter recommendation state when deterministic reasoning finds no valid pair', async () => {
    mocks.reasonServiceProvider.mockResolvedValue({ recommendedServiceId: null, recommendedServiceName: null, recommendedProviderId: null, recommendedProviderName: null, candidates: [], multipleProviders: false });
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) }));
    const client = { from: vi.fn(() => ({ update })) };

    await analyzeAndPersistMessage(client as any, { clinicId, conversationId, text: 'عندي ألم في ضرس' });

    expect(mocks.persistConversationState).toHaveBeenCalledWith(clinicId, conversationId, expect.objectContaining({
      state: 'DISCOVERING_PROBLEM',
      recommended_service_id: null,
      recommended_provider_id: null,
    }));
  });
});
