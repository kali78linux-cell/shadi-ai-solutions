import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamAndRecordResponse } from '@/lib/ai/streamingOrchestrator';
import { StreamingTextResponse } from 'ai';

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}));
vi.mock('@/lib/supabase', () => mockSupabase);

const mockOpenAI = vi.hoisted(() => {
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
    },
  };
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream),
        },
      },
    })),
  };
});
vi.mock('openai', () => mockOpenAI);

const mockIntelligence = vi.hoisted(() => ({ analyzeAndPersistMessage: vi.fn() }));
vi.mock('@/lib/services/conversationIntelligence', () => mockIntelligence);

const mockConversationService = vi.hoisted(() => ({ updateConversationState: vi.fn(), getConversationById: vi.fn() }));
vi.mock('@/lib/services/conversationService', () => mockConversationService);

const mockNotificationService = vi.hoisted(() => ({ notifyStaffForHandoff: vi.fn() }));
vi.mock('@/lib/services/notificationService', () => mockNotificationService);

const mockMessageService = vi.hoisted(() => ({ getConversationHistory: vi.fn() }));
vi.mock('@/lib/services/messageService', () => mockMessageService);

const mockContextRetrieval = vi.hoisted(() => ({ retrieveContext: vi.fn() }));
vi.mock('@/lib/ai/contextRetrieval', () => mockContextRetrieval);

const mockPromptManager = vi.hoisted(() => ({ buildPrompt: vi.fn() }));
vi.mock('@/lib/ai/promptManager', () => mockPromptManager);


describe('Streaming AI Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.supabase.from('clinic_ai_settings').select().eq().limit().single.mockResolvedValue({ data: { assistant_name: 'TestBot' }, error: null });
    mockIntelligence.analyzeAndPersistMessage.mockResolvedValue({ shouldHandoff: false });
    mockMessageService.getConversationHistory.mockResolvedValue([]);
    mockContextRetrieval.retrieveContext.mockResolvedValue([]);
    mockPromptManager.buildPrompt.mockReturnValue('Test prompt');
  });

  it('should return a StreamingTextResponse for a valid request', async () => {
    const response = await streamAndRecordResponse({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: 'Hello',
    });

    expect(response).toBeInstanceOf(StreamingTextResponse);

    // Read the stream to verify its content
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let result = '';
    let chunk = await reader?.read();
    while (chunk && !chunk.done) {
      result += decoder.decode(chunk.value);
      chunk = await reader?.read();
    }

    expect(result).toContain('Hello world');
  });

  it('should trigger handoff and return a regular JSON response', async () => {
    mockIntelligence.analyzeAndPersistMessage.mockResolvedValue({ shouldHandoff: true, intent: 'human_handoff' });

    const response = await streamAndRecordResponse({
      clinicId: 'clinic-1',
      conversationId: 'conv-1',
      text: 'I need a human',
    });

    // Verify it's NOT a streaming response
    expect(response).not.toBeInstanceOf(StreamingTextResponse);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.message).toContain('Handoff triggered');

    // Verify handoff actions were called
    expect(mockConversationService.updateConversationState).toHaveBeenCalledWith('conv-1', 'awaiting_staff');
    expect(mockNotificationService.notifyStaffForHandoff).toHaveBeenCalledWith('clinic-1', 'conv-1');
  });
});