import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamAndRecordResponse } from '@/lib/ai/streamingOrchestrator';
import { StreamingTextResponse } from '@/lib/ai/streamingResponse';

const mockAdminClient = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ error: null }),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
}));

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  supabase: mockAdminClient,
}));
vi.mock('@/lib/supabase', () => mockSupabase);
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockAdminClient,
}));

// Mock the provider abstraction so streamAndRecordResponse uses our fake provider
const mockProvider = vi.hoisted(() => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('Hello'));
      controller.enqueue(new TextEncoder().encode(' world'));
      controller.close();
    },
  });
  return {
    getProvider: vi.fn().mockReturnValue({
      id: 'mock-provider',
      stream: vi.fn().mockResolvedValue(stream),
    }),
    registerProvider: vi.fn(),
    // Resilience (openStreamWithFailover) enumerates candidates via
    // listProviders → provide the same streaming mock so the new resilient
    // OPEN returns it as the (only) failover candidate.
    listProviders: vi.fn().mockReturnValue([
      {
        id: 'mock-provider',
        stream: vi.fn().mockResolvedValue(stream),
      },
    ]),
  };
});
vi.mock('@/lib/ai/provider', () => mockProvider);

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

const mockSecurity = vi.hoisted(() => ({
  moderateUserPrompt: vi.fn().mockResolvedValue(undefined),
  ContentFlaggedError: class ContentFlaggedError extends Error {},
}));
vi.mock('@/lib/ai/security', () => mockSecurity);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockCostService = vi.hoisted(() => ({ calculateCost: vi.fn(() => 0) }));
vi.mock('@/lib/services/aiCostService', () => mockCostService);

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
    expect(mockConversationService.updateConversationState).toHaveBeenCalledWith('conv-1', 'awaiting_staff', 'clinic-1');
    expect(mockNotificationService.notifyStaffForHandoff).toHaveBeenCalledWith('clinic-1', 'conv-1');
  });

  it('uses the configured threshold and keeps grounded context (does NOT fall back to "unavailable")', async () => {
    // Demo clinic real configured threshold.
    mockSupabase.supabase.from('clinic_ai_settings').select().eq().limit().single.mockResolvedValue({
      data: { assistant_name: 'TestBot', confidence_threshold: 0.25 }, error: null,
    });
    // A strong-but-sparse chunk that the internal 0.7 assembly threshold would have
    // marked hasSufficientContext=false, but the configured 0.25 accepts.
    mockContextRetrieval.retrieveContext.mockResolvedValue({
      chunks: [{ content: 'Cleaning costs $70.', citation: { chunkId: 'c1', confidenceScore: 0.62 } }],
      citations: [{ chunkId: 'c1', confidenceScore: 0.62, content: 'Cleaning costs $70.' }],
      totalTokens: 5, truncated: false, hasSufficientContext: true, hasConflictingContext: false,
    });
    mockPromptManager.buildPrompt.mockReturnValue('RAG PROMPT');

    const response = await streamAndRecordResponse({
      clinicId: 'clinic-1', conversationId: 'conv-1', text: 'How much is cleaning?',
    });

    expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('clinic-1', 'How much is cleaning?', 5, 2000, 0.25);
    // Real streaming response (grounded context reached the LLM), NOT the text fallback.
    expect(response).toBeInstanceOf(StreamingTextResponse);
    expect(mockPromptManager.buildPrompt).toHaveBeenCalled();
  });

  it('returns the honest unavailable fallback (no fabricated citation) when no KB context matches', async () => {
    mockContextRetrieval.retrieveContext.mockResolvedValue({
      chunks: [], citations: [], totalTokens: 0, truncated: false, hasSufficientContext: false, hasConflictingContext: false,
    });

    const response = await streamAndRecordResponse({
      clinicId: 'clinic-1', conversationId: 'conv-1', text: 'Do you offer a NewTom panoramic device?',
    });

    // No LLM reach, no invented citation.
    expect(mockPromptManager.buildPrompt).not.toHaveBeenCalled();
    expect(response).not.toBeInstanceOf(StreamingTextResponse);
    const text = await response.text();
    expect(text).toContain('don\'t have enough reliable information');
  });

});