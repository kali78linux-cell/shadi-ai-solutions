import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vectorSearchClinic } from '@/lib/services/knowledge/retrieval';

// Mock dependencies
const mockProvider = vi.hoisted(() => ({
  getProvider: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => mockProvider);

const mockSupabase = vi.hoisted(() => ({
  supabase: {
    rpc: vi.fn(),
  },
}));
vi.mock('@/lib/supabase', () => mockSupabase);

const mockLogging = vi.hoisted(() => ({
  logEvent: vi.fn(),
}));
vi.mock('@/lib/server/logging', () => mockLogging);


describe('Knowledge Retrieval Service', () => {
  const mockEmbedProvider = {
    id: 'test-provider',
    generate: vi.fn(),
    embed: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getProvider.mockReturnValue(mockEmbedProvider);
  });

  it('should generate an embedding and call the match_clinic_documents RPC', async () => {
    const clinicId = 'clinic-123';
    const query = 'How much for a cleaning?';
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockChunks = [{ id: 'chunk-1', content: 'A cleaning costs $100.', similarity: 0.9 }];

    mockEmbedProvider.embed.mockResolvedValue({ embedding: mockEmbedding });
    mockSupabase.supabase.rpc.mockResolvedValue({ data: mockChunks, error: null });

    const result = await vectorSearchClinic(clinicId, query);

    expect(mockEmbedProvider.embed).toHaveBeenCalledWith(query);
    expect(mockSupabase.supabase.rpc).toHaveBeenCalledWith('match_clinic_documents', {
      p_clinic_id: clinicId,
      p_query_embedding: mockEmbedding,
      p_match_threshold: expect.any(Number),
      p_match_count: expect.any(Number),
    });
    expect(result).toEqual(mockChunks);
  });

  it('should return an empty array and log an error if RPC fails', async () => {
    const clinicId = 'clinic-123';
    const query = 'How much for a cleaning?';
    const mockEmbedding = [0.1, 0.2, 0.3];
    const rpcError = new Error('Connection timed out');

    mockEmbedProvider.embed.mockResolvedValue({ embedding: mockEmbedding });
    mockSupabase.supabase.rpc.mockResolvedValue({ data: null, error: rpcError });

    const result = await vectorSearchClinic(clinicId, query);

    expect(result).toEqual([]);
    expect(mockLogging.logEvent).toHaveBeenCalledWith(
      'retrieval_error',
      expect.objectContaining({ error: expect.stringContaining('RPC match_clinic_documents failed') }),
      'error'
    );
  });

  it('should throw an error if the provider does not support embeddings', async () => {
    mockProvider.getProvider.mockReturnValue({ id: 'no-embed-provider', generate: vi.fn() }); // No embed method

    await expect(vectorSearchClinic('clinic-123', 'query')).rejects.toThrow(
      'The configured AI provider does not support embeddings.'
    );
  });
});