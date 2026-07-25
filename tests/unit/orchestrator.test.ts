import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleIncomingMessage } from '@/lib/ai/orchestrator';

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase', () => mockSupabase);

const mockProvider = vi.hoisted(() => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
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
  sanitizeForPrompt: vi.fn((text) => text), // Pass-through by default
}));
vi.mock('@/lib/ai/security', () => mockSecurity);


describe('AI Orchestrator RAG Pipeline', () => {
  const mockAiProvider = {
    id: 'test-provider',
    generate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getProvider.mockReturnValue(mockAiProvider);
    mockSupabase.supabase.from('messages').insert.mockReturnThis();
    mockSupabase.supabase.from('messages').select.mockReturnThis();
    mockSupabase.supabase.from('messages').single.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
    mockSupabase.supabase.from('clinic_ai_settings').select().eq().limit().single.mockResolvedValue({ data: { assistant_name: 'TestBot' }, error: null });
    mockIntelligence.analyzeAndPersistMessage.mockResolvedValue({ intent: 'services_inquiry', shouldHandoff: false } as any);
    mockMessageService.getConversationHistory.mockResolvedValue([]);
  });

  it('should retrieve context, build a RAG prompt, and generate a response', async () => {
    const userQuery = 'How much for a root canal?';
    const retrievedContext = [{ id: 'chunk-1', content: 'A root canal costs $1200.', similarity: 0.9 }];
    const finalPrompt = 'RAG PROMPT: A root canal costs $1200. How much for a root canal?';
    const aiResponse = { text: 'Based on our documents, a root canal costs $1200.', tokens: 20, model: 'test-model' };

    // Setup mocks for this test case
    mockMessageService.getConversationHistory.mockResolvedValue([]);
    mockContextRetrieval.retrieveContext.mockResolvedValue(retrievedContext);
    mockPromptManager.buildPrompt.mockReturnValue(finalPrompt);
    mockAiProvider.generate.mockResolvedValue(aiResponse);
    mockCostService.calculateCost.mockReturnValue(0.0002);
    mockSupabase.supabase.from('ai_usage').insert.mockResolvedValue({ error: null });
    mockSupabase.supabase.from('ai_events').insert.mockResolvedValue({ error: null });

    await handleIncomingMessage({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: userQuery,
    });

    // 1. Verify history and context were retrieved
    expect(mockMessageService.getConversationHistory).toHaveBeenCalledWith('conv-1', 10);
    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', userQuery, 5);

    // 2. Verify prompt was built with history and context
    expect(mockPromptManager.buildPrompt).toHaveBeenCalledWith(
      expect.any(Object), // settings
      userQuery,
      [], // history
      retrievedContext
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
    expect(mockCostService.calculateCost).toHaveBeenCalledWith(aiResponse.model, aiResponse.tokens);
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
    mockSupabase.supabase.from('ai_usage').insert.mockResolvedValue({ error: null });
    mockSupabase.supabase.from('ai_events').insert.mockResolvedValue({ error: null });

    await handleIncomingMessage({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: userQuery,
    });

    // Verify context retrieval was attempted
    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', userQuery, 5);

    // Verify prompt was built with an empty context array
    expect(mockPromptManager.buildPrompt).toHaveBeenCalledWith(
      expect.any(Object),
      userQuery,
      [], // history
      noContext
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

    const result = await handleIncomingMessage({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: userQuery,
    });

    // 1. Verify AI response was NOT generated
    expect(mockContextRetrieval.retrieveContext).not.toHaveBeenCalled();
    expect(mockPromptManager.buildPrompt).not.toHaveBeenCalled();
    expect(mockAiProvider.generate).not.toHaveBeenCalled();
    expect(result).toBeNull();

    // 2. Verify handoff actions were taken
    expect(mockConversationService.updateConversationState).toHaveBeenCalledWith('conv-1', 'awaiting_staff');
    expect(mockNotificationService.notifyStaffForHandoff).toHaveBeenCalledWith('clinic-1', 'conv-1');
    expect(mockLogging.logEvent).toHaveBeenCalledWith('ai_handoff_triggered', expect.any(Object));
  });
});