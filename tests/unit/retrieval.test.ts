import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vectorSearchClinic, keywordSearchClinic, hybridSearchClinic, RetrievalResult } from '@/lib/services/knowledge/retrieval';

// Mock dependencies
const mockProvider = vi.hoisted(() => ({
  getProvider: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => mockProvider);

const mockSupabase = vi.hoisted(() => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
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

  describe('vectorSearchClinic', () => {
    it('should generate an embedding and call the match_clinic_documents RPC', async () => {
      const clinicId = 'clinic-123';
      const query = 'How much for a cleaning?';
      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockChunks: RetrievalResult[] = [{
        id: 'chunk-1',
        content: 'A cleaning costs $100.',
        similarity: 0.9,
        document_id: 'doc-1',
        chunk_index: 0,
        type: 'unstructured',
        metadata: {},
      }];

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

  describe('keywordSearchClinic', () => {
    it('should preserve similarity and set keywordScore separately', async () => {
      const clinicId = 'clinic-123';
      const query = 'cleaning implant';
      const mockChunks: RetrievalResult[] = [
        {
          id: 'chunk-1',
          content: 'A cleaning costs $100 and implants are available.',
          similarity: 0.85, // raw vector similarity — must be preserved
          document_id: 'doc-1',
          chunk_index: 0,
          type: 'unstructured',
          metadata: {},
        },
      ];

      // Mock the supabase.from chain
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
      mockSupabase.supabase.from.mockReturnValue(mockChain);
      mockChain.limit.mockResolvedValue({ data: mockChunks, error: null });

      const result = await keywordSearchClinic(clinicId, query);

      expect(result.length).toBe(1);
      // similarity must be preserved (not overwritten by keywordScore)
      expect(result[0].similarity).toBe(0.85);
      // keywordScore should be set separately
      expect(result[0].keywordScore).toBeDefined();
      expect(result[0].keywordScore).toBeGreaterThan(0);
    });

    it('should return empty array if no search terms', async () => {
      const result = await keywordSearchClinic('clinic-123', 'a');
      expect(result).toEqual([]);
    });
  });

  describe('hybridSearchClinic', () => {
    it('should preserve similarity and set rankingScore from hybridScore', async () => {
      const clinicId = 'clinic-123';
      const query = 'cleaning';
      const mockEmbedding = [0.1, 0.2, 0.3];

      const vectorChunks: RetrievalResult[] = [
        {
          id: 'chunk-1',
          content: 'A cleaning costs $100.',
          similarity: 0.9, // raw vector similarity — must be preserved
          document_id: 'doc-1',
          chunk_index: 0,
          type: 'unstructured',
          metadata: {},
        },
      ];

      const keywordChunks: RetrievalResult[] = [
        {
          id: 'chunk-1',
          content: 'A cleaning costs $100.',
          similarity: 0.9, // raw vector similarity — must be preserved
          document_id: 'doc-1',
          chunk_index: 0,
          type: 'unstructured',
          metadata: {},
          keywordScore: 1.0,
        },
      ];

      mockEmbedProvider.embed.mockResolvedValue({ embedding: mockEmbedding });
      mockSupabase.supabase.rpc.mockResolvedValue({ data: vectorChunks, error: null });

      // Mock the supabase.from chain for keyword search
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
      mockSupabase.supabase.from.mockReturnValue(mockChain);
      mockChain.limit.mockResolvedValue({ data: keywordChunks, error: null });

      const result = await hybridSearchClinic(clinicId, query);

      expect(result.length).toBe(1);
      // similarity must be preserved (not overwritten by hybridScore)
      expect(result[0].similarity).toBe(0.9);
      // hybridScore should be set
      expect(result[0].hybridScore).toBeDefined();
      // vectorScore should equal similarity
      expect(result[0].vectorScore).toBe(0.9);
      // keywordScore should be set
      expect(result[0].keywordScore).toBe(1.0);
    });
  });
});
