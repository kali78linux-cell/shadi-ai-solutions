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
    functions: { invoke: vi.fn() },
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

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('process-document', {
      body: { documentId: mockDocumentRecord.id, storagePath: `${clinicId}/mock-uuid.txt` },
    });
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

  it('should soft delete a document and remove its file from storage', async () => {
    const documentId = 'doc-to-delete';
    const clinicId = 'test-clinic-id';
    const storagePath = `${clinicId}/file.pdf`;

    mockSupabase.from('clinic_knowledge_documents').select().eq().single.mockResolvedValue({
      data: { id: documentId, clinic_id: clinicId, storage_path: storagePath },
      error: null,
    });
    mockSupabase.from('clinic_ai_knowledge').delete().eq.mockResolvedValue({ error: null });
    mockSupabase.from('clinic_knowledge_documents').update.mockResolvedValue({ error: null });
    mockSupabase.storage.from('knowledge_documents').remove.mockResolvedValue({ data: {}, error: null });

    await knowledgeService.deleteDocument(documentId, clinicId);

    // Verify document is soft-deleted
    expect(mockSupabase.from).toHaveBeenCalledWith('clinic_knowledge_documents');
    expect(mockSupabase.from('clinic_knowledge_documents').update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) })
    );

    // Verify chunks are deleted after the document is soft-deleted
    expect(mockSupabase.from).toHaveBeenCalledWith('clinic_ai_knowledge');
    expect(mockSupabase.from('clinic_ai_knowledge').delete().eq).toHaveBeenCalledWith('document_id', documentId);

    // Verify file is removed from storage at the end
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('knowledge_documents');
    expect(mockSupabase.storage.remove).toHaveBeenCalledWith([storagePath]);
  });

  it('should re-index a document', async () => {
    const documentId = 'doc-to-reindex';
    const clinicId = 'test-clinic-id';
    const storagePath = `${clinicId}/file.pdf`;
    const updatedDoc = { id: documentId, processing_status: 'pending' };

    mockSupabase.from('clinic_knowledge_documents').select().eq().single.mockResolvedValue({
      data: { id: documentId, clinic_id: clinicId, storage_path: storagePath },
      error: null,
    });
    mockSupabase.from('clinic_ai_knowledge').delete().eq.mockResolvedValue({ error: null });
    mockSupabase.from('clinic_knowledge_documents').update().eq().select().single.mockResolvedValue({
      data: updatedDoc,
      error: null,
    });
    mockSupabase.functions.invoke.mockResolvedValue({ data: {}, error: null });

    const result = await knowledgeService.reindexDocument(documentId, clinicId);

    // Verify old chunks are deleted
    expect(mockSupabase.from('clinic_ai_knowledge').delete().eq).toHaveBeenCalledWith('document_id', documentId);

    // Verify document status is reset
    expect(mockSupabase.from('clinic_knowledge_documents').update).toHaveBeenCalledWith(
      expect.objectContaining({ processing_status: 'pending' })
    );

    // Verify edge function is invoked
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('process-document', {
      body: { documentId, storagePath },
    });

    expect(result).toEqual(updatedDoc);
  });
});