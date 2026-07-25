import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeService } from '../../lib/services/knowledgeService';
import { createClient } from '@supabase/supabase-js';

// Mock external dependencies
const mockDocParser = vi.hoisted(() => ({
  extractTextFromBuffer: vi.fn(),
  chunkText: vi.fn(),
}));
vi.mock('@/lib/ai/docParser', () => mockDocParser);

const mockProvider = vi.hoisted(() => ({
  getProvider: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => mockProvider);

// Mock Supabase client
const mockSupabase = {
  storage: {
    from: vi.fn().mockReturnThis(),
    upload: vi.fn(),
    remove: vi.fn(),
  },
  from: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('KnowledgeService', () => {
  let knowledgeService: KnowledgeService;
  const mockEmbeddingProvider = {
    generateEmbedding: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const supabaseClient = createClient('http://mock.url', 'mock.key');
    knowledgeService = new KnowledgeService(supabaseClient as any);
    mockProvider.getProvider.mockReturnValue(mockEmbeddingProvider);
  });

  it('should handle document upload and initiate processing', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const clinicId = 'test-clinic-id';
    const userId = 'test-user-id';

    mockSupabase.storage.from('knowledge_documents').upload.mockResolvedValue({ data: {}, error: null });

    const mockDocumentRecord = { id: 'doc-id-123', clinic_id: clinicId, uploaded_by: userId, original_filename: 'test.txt', processing_status: 'pending' };
    mockSupabase.from('clinic_knowledge_documents').insert.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.single.mockResolvedValue({ data: mockDocumentRecord, error: null });

    const processDocumentSpy = vi.spyOn(knowledgeService, 'processDocument').mockImplementation(async () => {});

    const result = await knowledgeService.handleUpload({ file, clinicId, userId });

    expect(mockSupabase.storage.from).toHaveBeenCalledWith('knowledge_documents');
    expect(mockSupabase.storage.upload).toHaveBeenCalledWith(`${clinicId}/mock-uuid.txt`, file);

    expect(mockSupabase.from).toHaveBeenCalledWith('clinic_knowledge_documents');
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: clinicId,
      uploaded_by: userId,
      original_filename: 'test.txt',
      storage_path: `${clinicId}/mock-uuid.txt`,
      upload_status: 'success',
      processing_status: 'pending',
    }));

    expect(processDocumentSpy).toHaveBeenCalledWith(mockDocumentRecord.id, file);
    expect(result).toEqual(mockDocumentRecord);
  });

  it('should throw an error if storage upload fails', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const clinicId = 'test-clinic-id';
    const userId = 'test-user-id';

    const uploadError = { message: 'Storage access denied', name: 'StorageError' };
    mockSupabase.storage.from('knowledge_documents').upload.mockResolvedValue({ data: null, error: uploadError as any });

    await expect(knowledgeService.handleUpload({ file, clinicId, userId }))
      .rejects
      .toThrow('Failed to upload file to storage: Storage access denied');
  });

  it('should clean up storage if database insert fails', async () => {
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const clinicId = 'test-clinic-id';
    const userId = 'test-user-id';

    // Mock storage upload to succeed
    mockSupabase.storage.from('knowledge_documents').upload.mockResolvedValue({ data: {}, error: null });

    // Mock database insert to fail
    const dbError = { message: 'DB insert failed', code: '23505' };
    mockSupabase.from('clinic_knowledge_documents').insert.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.single.mockResolvedValue({ data: null, error: dbError });

    await expect(knowledgeService.handleUpload({ file, clinicId, userId }))
      .rejects.toThrow('Failed to create document record: DB insert failed');

    expect(mockSupabase.storage.from).toHaveBeenCalledWith('knowledge_documents');
    expect(mockSupabase.storage.remove).toHaveBeenCalledWith([`${clinicId}/mock-uuid.txt`]);
  });

  it('should process a document by parsing, chunking, and embedding', async () => {
    const file = new File(['full document content'], 'test.txt', { type: 'text/plain' });
    const documentId = 'doc-id-123';
    const clinicId = 'clinic-id-456';

    // Mock return values
    mockDocParser.extractTextFromBuffer.mockResolvedValue('full document content');
    mockDocParser.chunkText.mockReturnValue(['chunk 1', 'chunk 2']);
    mockEmbeddingProvider.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSupabase.from('clinic_knowledge_documents').select('clinic_id').eq('id', documentId).single.mockResolvedValue({ data: { clinic_id: clinicId }, error: null });
    mockSupabase.from('clinic_ai_knowledge').insert.mockResolvedValue({ error: null });
    mockSupabase.from('clinic_knowledge_documents').update.mockResolvedValue({ error: null });

    await knowledgeService.processDocument(documentId, file);

    // Verify status updates
    expect(mockSupabase.from('clinic_knowledge_documents').update).toHaveBeenCalledWith({ processing_status: 'processing' });
    expect(mockSupabase.from('clinic_knowledge_documents').update).toHaveBeenCalledWith({ processing_status: 'chunking' });
    expect(mockSupabase.from('clinic_knowledge_documents').update).toHaveBeenCalledWith({ processing_status: 'embedding' });

    // Verify processing steps
    expect(mockDocParser.extractTextFromBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'test.txt');
    expect(mockDocParser.chunkText).toHaveBeenCalledWith('full document content');
    expect(mockProvider.getProvider).toHaveBeenCalled();
    expect(mockEmbeddingProvider.generateEmbedding).toHaveBeenCalledTimes(2);
    expect(mockEmbeddingProvider.generateEmbedding).toHaveBeenCalledWith('chunk 1');
    expect(mockEmbeddingProvider.generateEmbedding).toHaveBeenCalledWith('chunk 2');

    // Verify database inserts for chunks
    expect(mockSupabase.from('clinic_ai_knowledge').insert).toHaveBeenCalledTimes(2);
    expect(mockSupabase.from('clinic_ai_knowledge').insert).toHaveBeenCalledWith({
      document_id: documentId,
      clinic_id: clinicId,
      type: 'unstructured',
      content: 'chunk 1',
      chunk_index: 0,
      embedding_vector: [0.1, 0.2, 0.3],
    });

    // Verify final status update
    expect(mockSupabase.from('clinic_knowledge_documents').update).toHaveBeenCalledWith(expect.objectContaining({
      processing_status: 'indexed',
      chunk_count: 2,
    }));
  });
});