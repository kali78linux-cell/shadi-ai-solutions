import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleIncomingMessage } from '@/lib/ai/orchestrator';

// Mock dependencies
const mockSupabase = vi.hoisted(() => {
  const chainable = {
    from: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
  };
  Object.values(chainable).forEach((fn) => fn.mockReturnValue(chainable));
  return { supabase: chainable };
});

const mockClinicDataContext = vi.hoisted(() => ({
  loadClinicOperatingData: vi.fn(),
  loadReceptionistConversationState: vi.fn(),
  loadClinicProfile: vi.fn(async () => ({ id: 'clinic-1', slug: '', name: 'Demo', address: null, phone: null, website: null, timezone: null, hasProfile: true })),
  persistReceptionistSlot: vi.fn(async () => {}),
  OPERATIVE_CONVERSATION_INTENTS: new Set(['appointment_booking','appointment_reschedule','appointment_cancellation','patient_complaint','dental_general_question','general_question','greeting','goodbye','human_handoff','unknown']),
}));
vi.mock('@/lib/ai/clinicDataContext', () => mockClinicDataContext);

const mockAvailabilityTool = vi.hoisted(() => ({
  findEarliestAvailableSlot: vi.fn(async () => ({ found: false, reason: 'no_slots' })),
  resolveServiceByName: vi.fn(() => null),
  resolveProviderByName: vi.fn(() => null),
}));
vi.mock('@/lib/ai/availabilityTool', () => mockAvailabilityTool);

const mockConversationContext = vi.hoisted(() => ({
  saveConversationContext: vi.fn(async () => true),
}));
vi.mock('@/lib/ai/conversationContext', () => mockConversationContext);

vi.mock('@/lib/ai/understanding', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    understandMessage: vi.fn(() => ({})),
    applyUnderstandingToState: vi.fn((s: unknown) => s),
  };
});

const mockConversationBooking = vi.hoisted(() => ({
  attemptConversationBooking: vi.fn(),
}));
vi.mock('@/lib/ai/conversationBooking', () => mockConversationBooking);
vi.mock('@/lib/supabase', () => mockSupabase);
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockSupabase.supabase,
}));

const mockProvider = vi.hoisted(() => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
  listProviders: vi.fn(() => []),
}));
vi.mock('@/lib/ai/provider', () => mockProvider);

const mockContextRetrieval = vi.hoisted(() => ({
  retrieveContext: vi.fn(),
}));
vi.mock('@/lib/ai/contextRetrieval', () => mockContextRetrieval);

const mockPromptManager = vi.hoisted(() => ({
  buildPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/promptManager', () => mockPromptManager);

const mockMessageService = vi.hoisted(() => ({
  getConversationHistory: vi.fn(),
}));
vi.mock('@/lib/services/messageService', () => mockMessageService);

const mockConversationService = vi.hoisted(() => ({
  updateConversationState: vi.fn(),
  getConversationById: vi.fn(),
}));
vi.mock('@/lib/services/conversationService', () => mockConversationService);

const mockNotificationService = vi.hoisted(() => ({
  notifyStaffForHandoff: vi.fn(),
}));
vi.mock('@/lib/services/notificationService', () => mockNotificationService);

const mockCostService = vi.hoisted(() => ({
  calculateCost: vi.fn(),
}));
vi.mock('@/lib/services/aiCostService', () => mockCostService);

const mockIntelligence = vi.hoisted(() => ({
  analyzeAndPersistMessage: vi.fn(),
}));
vi.mock('@/lib/services/conversationIntelligence', () => mockIntelligence);

const mockLogging = vi.hoisted(() => ({
  logEvent: vi.fn(),
}));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockSecurity = vi.hoisted(() => ({
  moderateUserPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/security', () => mockSecurity);


describe('AI Orchestrator RAG Pipeline', () => {
  const mockAiProvider = {
    id: 'test-provider',
    generate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set chainable return values after clearAllMocks
    Object.values(mockSupabase.supabase).forEach((fn) => fn.mockReturnValue(mockSupabase.supabase));
    mockProvider.getProvider.mockReturnValue(mockAiProvider);
    // generateWithFailover enumerates the registry for failover — expose the
    // same mocked provider so resilience resolves to it in these tests.
    mockProvider.listProviders.mockReturnValue([mockAiProvider]);
    mockSupabase.supabase.from('messages').single.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
    mockSupabase.supabase.from('clinic_ai_settings').select().eq().limit().single.mockResolvedValue({ data: { assistant_name: 'TestBot' }, error: null });
    mockIntelligence.analyzeAndPersistMessage.mockResolvedValue({ intent: 'services_inquiry', shouldHandoff: false, state: 'ai' } as any);
    mockMessageService.getConversationHistory.mockResolvedValue([]);
    mockClinicDataContext.loadClinicOperatingData.mockResolvedValue({ services: [], providers: [], providerServiceIds: [], hasServices: false, hasProviders: false, usable: false });
    mockClinicDataContext.loadReceptionistConversationState.mockResolvedValue(null);
    mockConversationBooking.attemptConversationBooking.mockResolvedValue({ action: 'not_ready', state: 'INITIAL' });
  });

  it('should retrieve context, build a RAG prompt, and generate a response', async () => {
    const userQuery = 'How much for a root canal?';
    const retrievedContext = [{ id: 'chunk-1', content: 'A root canal costs $1200.', similarity: 0.9 }];
    const finalPrompt = 'RAG PROMPT: A root canal costs $1200. How much for a root canal?';
    const aiResponse = { text: 'Based on our documents, a root canal costs $1200.', promptTokens: 10, completionTokens: 10, totalTokens: 20, model: 'test-model' };

    // Setup mocks for this test case
    mockMessageService.getConversationHistory.mockResolvedValue([]);
    mockContextRetrieval.retrieveContext.mockResolvedValue(retrievedContext);
    mockPromptManager.buildPrompt.mockReturnValue(finalPrompt);
    mockAiProvider.generate.mockResolvedValue(aiResponse);
    mockCostService.calculateCost.mockReturnValue(0.0002);

    await handleIncomingMessage({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: userQuery,
    });

    // 1. Verify history and context were retrieved
    expect(mockMessageService.getConversationHistory).toHaveBeenCalledWith('conv-1', 10);
    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', userQuery, 5, 2000, 0.7);

    // 2. Verify prompt was built with history, context, and enhanced options
    expect(mockPromptManager.buildPrompt).toHaveBeenCalledWith(
      expect.any(Object), // settings
      userQuery,
      [], // history
      retrievedContext,
      undefined, // citations (legacy array path)
      expect.objectContaining({
        confidenceThreshold: expect.any(Number),
        safetyRules: expect.any(Array),
        answerBoundaries: expect.any(Array),
        handoffConditions: expect.any(Array),
        intent: 'services_inquiry',
        conversationState: 'ai',
      })
    );

    // 3. Verify AI provider was called with the final RAG prompt
    expect(mockAiProvider.generate).toHaveBeenCalledWith({ prompt: finalPrompt });

    // 4. Verify the final AI message was persisted
    expect(mockSupabase.supabase.from('messages').insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'patient', content: userQuery }),
      ])
    );
    expect(mockSupabase.supabase.from('messages').insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: aiResponse.text })
      ])
    );

    // 5. Verify usage was tracked with cost
    expect(mockCostService.calculateCost).toHaveBeenCalledWith(aiResponse.model, aiResponse.promptTokens, aiResponse.completionTokens);
    expect(mockSupabase.supabase.from('ai_usage').insert).toHaveBeenCalledWith([expect.objectContaining({ estimated_cost: 0.0002 })]);
  });

  it('should handle cases where no context is found', async () => {
    const userQuery = 'Hello, how are you?';
    const noContext: any[] = [];
    const fallbackPrompt = 'FALLBACK PROMPT: Hello, how are you?';
    const aiResponse = { text: 'I am doing well, thank you for asking!', tokens: 10, model: 'test-model' };

    // Setup mocks
    mockMessageService.getConversationHistory.mockResolvedValue([]);
    mockContextRetrieval.retrieveContext.mockResolvedValue(noContext);
    mockPromptManager.buildPrompt.mockReturnValue(fallbackPrompt);
    mockAiProvider.generate.mockResolvedValue(aiResponse);

    await handleIncomingMessage({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: userQuery,
    });

    // Verify context retrieval was attempted
    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', userQuery, 5, 2000, 0.7);

    // Verify prompt was built with an empty context array and enhanced options
    expect(mockPromptManager.buildPrompt).toHaveBeenCalledWith(
      expect.any(Object),
      userQuery,
      [], // history
      noContext,
      undefined, // citations (legacy array path)
      expect.objectContaining({
        confidenceThreshold: expect.any(Number),
        safetyRules: expect.any(Array),
        answerBoundaries: expect.any(Array),
        handoffConditions: expect.any(Array),
        intent: 'services_inquiry',
        conversationState: 'ai',
      })
    );

    // Verify AI provider was called with the fallback prompt
    expect(mockAiProvider.generate).toHaveBeenCalledWith({ prompt: fallbackPrompt });
  });

  it('should stop processing and trigger handoff when required', async () => {
    const userQuery = 'I need to speak to a human now!';

    // Setup mocks for handoff
    mockIntelligence.analyzeAndPersistMessage.mockResolvedValue({
      intent: 'human_handoff',
      shouldHandoff: true,
    } as any);
    mockConversationService.updateConversationState.mockResolvedValue({} as any);
    mockConversationService.getConversationById.mockResolvedValue({ id: 'conv-1', clinic_id: 'clinic-1', patient_id: 'patient-1' });

describe('AI Orchestrator — empty Knowledge Base must not block a booking conversation', () => {
  it('proceeds to the LLM (receptionist) when KB is empty and the intent is operative', async () => {
    mockIntelligence.analyzeAndPersistMessage.mockResolvedValue({ intent: 'appointment_booking', shouldHandoff: false, state: 'ai' } as any);
    // Simulate the REAL retrieval path: an AssembledContext with NO chunks and
    // no citations (the clinic's Knowledge Base is empty).
    mockContextRetrieval.retrieveContext.mockResolvedValue({
      chunks: [], citations: [], totalTokens: 0, truncated: false, hasConflictingContext: false,
    });
    mockClinicDataContext.loadClinicOperatingData.mockResolvedValue({
      services: [{ id: 's1', name: 'تقويم أسنان', duration_minutes: 30, pricing_type: 'unspecified', price_min: null, price_max: null, price_visible_to_patients: true, active: true, description: null }],
      providers: [{ id: 'p1', name: 'د. سارة', title: 'تقويم' }],
      providerServiceIds: [{ provider_id: 'p1', service_id: 's1' }],
      hasServices: true, hasProviders: true, usable: true,
    });
    mockClinicDataContext.loadReceptionistConversationState.mockResolvedValue({
      state: 'DISCOVERING_PROBLEM', recommended_service_id: 's1', recommended_provider_id: 'p1',
      patient_confirmed_booking: false, pending_question: '', booking: { service_id: null, provider_id: null, slot: null, patient_name: null, phone: null, email: null },
    });
    const finalPrompt = 'RECEPTIONIST: Tell me about braces';
    mockPromptManager.buildPrompt.mockReturnValue(finalPrompt);
    mockAiProvider.generate.mockResolvedValue({ text: 'أكيد، أقدر أساعدك في موضوع التقويم. هل التقويم لك أم لطفل؟', promptTokens: 5, completionTokens: 5, totalTokens: 10, model: 'm' });

    await handleIncomingMessage({ clinicId: 'clinic-1', conversationId: 'conv-1', text: 'بدي تقويم' });

    // The conversation MUST have proceeded to the LLM (buildPrompt) and NOT
    // have inserted the "information unavailable" template.
    expect(mockPromptManager.buildPrompt).toHaveBeenCalled();
    const assistantInserts = mockSupabase.supabase.from('messages').insert.mock.calls
      .filter((args: any[]) => Array.isArray(args[0]) && args[0][0]?.role === 'assistant');
    expect(assistantInserts.length).toBe(1);
    expect(assistantInserts[0][0][0].content).toBe('أكيد، أقدر أساعدك في موضوع التقويم. هل التقويم لك أم لطفل؟');
    expect(assistantInserts[0][0][0].content).not.toContain('غير متوفرة');
  });
});
    const result = await handleIncomingMessage({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: userQuery,
    });

    // 1. Verify AI response was NOT generated — but the patient ALWAYS gets
    // a reply now: the persisted handoff acknowledgment (P0 fix).
    expect(mockContextRetrieval.retrieveContext).not.toHaveBeenCalled();
    expect(mockPromptManager.buildPrompt).not.toHaveBeenCalled();
    expect(mockAiProvider.generate).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.assistantMessage?.role).toBe('assistant');
    expect(String(result?.assistantMessage?.content)).toContain('فريق العيادة');

    // 2. Verify handoff actions were taken
    expect(mockConversationService.updateConversationState).toHaveBeenCalledWith('conv-1', 'awaiting_staff', 'clinic-1');
    expect(mockNotificationService.notifyStaffForHandoff).toHaveBeenCalledWith('clinic-1', 'conv-1');
    expect(mockLogging.logEvent).toHaveBeenCalledWith('ai_handoff_triggered', expect.any(Object));
  });

  it('passes the configured threshold to retrieveContext and reaches the LLM when a grounded chunk exists', async () => {
    mockSupabase.supabase.from('clinic_ai_settings').select().eq().limit().single.mockResolvedValue({
      data: { assistant_name: 'TestBot', confidence_threshold: 0.25 }, error: null,
    });
    const userQuery = 'How much does teeth cleaning cost?';
    // AssembledContext with a strong-but-sparse chunk: internal assembly with the
    // clinic threshold (0.25) marks it sufficient. NOTE: with the old hard-coded
    // 0.7 assembly default the identical chunk would have hasSufficientContext=false
    // in the streaming path — this test pins that the configured value flows in.
    mockContextRetrieval.retrieveContext.mockResolvedValue({
      chunks: [{ content: 'Cleaning costs $70.', citation: { chunkId: 'c1', confidenceScore: 0.62 } }],
      citations: [{ chunkId: 'c1', confidenceScore: 0.62, content: 'Cleaning costs $70.' }],
      totalTokens: 5, truncated: false, hasSufficientContext: true, hasConflictingContext: false,
    });
    mockPromptManager.buildPrompt.mockReturnValue('RAG PROMPT');
    mockAiProvider.generate.mockResolvedValue({ text: 'Costs $70.', promptTokens: 2, completionTokens: 2, totalTokens: 4, model: 'm' });

    await handleIncomingMessage({ clinicId: 'clinic-1', conversationId: 'conv-1', text: userQuery });

    // Configured 0.25 threshold must reach retrieveContext (was 0.7 default before fix).
    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', userQuery, 5, 2000, 0.25);
    // Grounded context reached the prompt builder (LLM path, not the unavailable template).
    expect(mockPromptManager.buildPrompt).toHaveBeenCalled();
    expect(mockAiProvider.generate).toHaveBeenCalled();
  });

  it('returns an honest unavailable reply (no fabricated citation) when no KB chunk matches', async () => {
    mockSupabase.supabase.from('clinic_ai_settings').select().eq().limit().single.mockResolvedValue({
      data: { assistant_name: 'TestBot', confidence_threshold: 0.25 }, error: null,
    });
    const userQuery = 'جراحة الفم والفكين في الفرع الثاني';
    mockContextRetrieval.retrieveContext.mockResolvedValue({
      chunks: [], citations: [], totalTokens: 0, truncated: false, hasSufficientContext: false, hasConflictingContext: false,
    });
    // operating data stays empty (beforeEach), intent stays services_inquiry (clinic-specific).

    await handleIncomingMessage({ clinicId: 'clinic-1', conversationId: 'conv-1', text: userQuery });

    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', userQuery, 5, 2000, 0.25);
    // No invention: LLM must NOT be reached, nothing fabricated.
    expect(mockPromptManager.buildPrompt).not.toHaveBeenCalled();
    expect(mockAiProvider.generate).not.toHaveBeenCalled();
    const assistantInserts = mockSupabase.supabase.from('messages').insert.mock.calls
      .filter((args: any[]) => Array.isArray(args[0]) && args[0][0]?.role === 'assistant');
    expect(assistantInserts.length).toBe(1);
    // Metadata marks it as a KB-gap fallback with zero citations.
    expect(assistantInserts[0][0][0].metadata?.reason).toBe('clinic_fact_unavailable');
    expect(Array.isArray(assistantInserts[0][0][0].metadata?.citations)).toBe(true);
    expect(assistantInserts[0][0][0].metadata?.citations.length).toBe(0);
  });
});
