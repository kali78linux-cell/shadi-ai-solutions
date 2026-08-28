import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = vi.hoisted(() => {
  let metadata: Record<string, unknown> = {};
  const query: Record<string, any> = {
    from: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return {
    supabaseAdmin: query,
    setMetadata(value: Record<string, unknown>) { metadata = value; },
    getMetadata() { return metadata; },
  };
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockSupabase.supabaseAdmin }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { CONVERSATION_STATES, createInitialState, persistConversationState } from '@/lib/services/conversationStateMachine';
import { EMPTY_PATIENT_CONTEXT } from '@/lib/services/patientContext';

const clinicId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';

function configureStore() {
  const q = mockSupabase.supabaseAdmin;
  q.from.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.maybeSingle.mockImplementation(async () => ({ data: { metadata: mockSupabase.getMetadata() }, error: null }));
  q.update.mockImplementation((payload: { metadata: Record<string, unknown> }) => {
    mockSupabase.setMetadata(payload.metadata);
    return q;
  });
}

function state() {
  const value = createInitialState({ ...EMPTY_PATIENT_CONTEXT, problem: 'ألم في ضرس', duration: 'من يومين' });
  value.state = CONVERSATION_STATES.DISCOVERING_PROBLEM;
  return value;
}

describe('conversation metadata persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.setMetadata({});
    configureStore();
  });

  it('keeps subject_analysis when state is persisted after PatientContext', async () => {
    mockSupabase.setMetadata({ subject_analysis: { problem: 'ألم في ضرس', trigger: 'البارد' }, intelligence: { intent: 'patient_complaint' } });

    await persistConversationState(clinicId, conversationId, state());

    expect(mockSupabase.getMetadata()).toMatchObject({
      subject_analysis: { problem: 'ألم في ضرس', trigger: 'البارد' },
      intelligence: { intent: 'patient_complaint' },
      state: CONVERSATION_STATES.DISCOVERING_PROBLEM,
    });
  });

  it('keeps both metadata domains across repeated state and PatientContext writes', async () => {
    await persistConversationState(clinicId, conversationId, state());
    mockSupabase.setMetadata({
      ...mockSupabase.getMetadata(),
      subject_analysis: { problem: 'ألم في ضرس', duration: 'من يومين', trigger: 'البارد' },
    });

    const updatedState = state();
    updatedState.state = CONVERSATION_STATES.COLLECTING_INFORMATION;
    await persistConversationState(clinicId, conversationId, updatedState);

    expect(mockSupabase.getMetadata()).toMatchObject({
      subject_analysis: { problem: 'ألم في ضرس', duration: 'من يومين', trigger: 'البارد' },
      state: CONVERSATION_STATES.COLLECTING_INFORMATION,
    });
  });

  it('keeps intelligence and recommendation IDs when the state is persisted again', async () => {
    mockSupabase.setMetadata({
      intelligence: { intent: 'patient_complaint' },
      conversation_state_machine: CONVERSATION_STATES.RECOMMENDING_PROVIDER,
      subject_analysis: { problem: 'ألم في ضرس' },
    });
    const recommended = state();
    recommended.state = CONVERSATION_STATES.RECOMMENDING_PROVIDER;
    recommended.recommended_service_id = 'service-a';
    recommended.recommended_provider_id = 'provider-a';

    await persistConversationState(clinicId, conversationId, recommended);

    expect(mockSupabase.getMetadata()).toMatchObject({
      intelligence: { intent: 'patient_complaint' },
      conversation_state_machine: CONVERSATION_STATES.RECOMMENDING_PROVIDER,
      subject_analysis: { problem: 'ألم في ضرس' },
      recommended_service_id: 'service-a',
      recommended_provider_id: 'provider-a',
    });
  });
});
