import type { SupabaseClient } from '@supabase/supabase-js';
import { ClinicKnowledgeDocument } from '@/types/db';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { extractTextFromBuffer, chunkText } from '@/lib/ai/docParser';
import { getProvider } from '@/lib/ai/provider';

export class KnowledgeService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async handleUpload({ file, clinicId, userId }: { file: File; clinicId: string; userId: string }) {
    const fileExtension = path.extname(file.name);
    const fileName = `${uuidv4()}${fileExtension}`;
    const storagePath = `${clinicId}/${fileName}`;

    // 1. Upload file to storage
    const { error: uploadError } = await this.supabase.storage
      .from('knowledge_documents')
      .upload(storagePath, file);

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw new Error(`Failed to upload file to storage: ${uploadError.message}`);
    }

    let docData;
    try {
      // 2. Create document record in the database
      const { data, error: docError } = await this.supabase
        .from('clinic_knowledge_documents')
        .insert({
          clinic_id: clinicId,
          uploaded_by: userId,
          original_filename: file.name,
          file_type: file.type,
          mime_type: file.type,
          file_size: file.size,
          storage_path: storagePath,
          upload_status: 'success',
          processing_status: 'pending',
        })
        .select()
        .single();

      if (docError) {
        throw docError;
      }
      docData = data;
    } catch (dbError: any) {
      console.error('Database insert error, rolling back storage upload:', dbError);
      // Rollback: remove the file from storage if DB insert fails.
      await this.supabase.storage.from('knowledge_documents').remove([storagePath]);
      throw new Error(`Failed to create document record: ${dbError.message}`);
    }

    // Asynchronously invoke the Edge Function to process the document in the background.
    try {
      await this.supabase.functions.invoke('process-document', {
        body: { documentId: docData.id, storagePath },
      });
    } catch (error) {
      console.error('Edge function invocation failed, marking document as failed:', error);
      await this.supabase
        .from('clinic_knowledge_documents')
        .update({ processing_status: 'failed' })
        .eq('id', docData.id);
      throw new Error(`Failed to process document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return docData as ClinicKnowledgeDocument;
  }

  /**
   * Processes a document by parsing, chunking, and embedding its content.
   * This method contains the core ingestion logic and is used for testing.
   * In production, this logic is executed within a Supabase Edge Function.
   */
  async processDocument(documentId: string, file: File) {
    // This method is preserved for testing purposes, allowing direct validation
    // of the ingestion pipeline without invoking an edge function.
    try {
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const content = await extractTextFromBuffer(fileBuffer, file.name);
      const chunks = chunkText(content);
      const provider = getProvider();
      const { data: doc } = await this.supabase.from('clinic_knowledge_documents').select('clinic_id').eq('id', documentId).single();
      const clinicId = doc?.clinic_id;

      if (!clinicId) {
        throw new Error(`Could not find clinic for document ${documentId}`);
      }

      // Build all chunk rows with embeddings before inserting
      const chunkRows = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedResult = await provider.embed(chunk);
        chunkRows.push({
          document_id: documentId,
          clinic_id: clinicId,
          type: 'unstructured',
          content: chunk,
          chunk_index: i,
          embedding: embedResult.embedding,
        });
      }

      // Insert all chunks as a single batch (array) — document metadata is updated
      // only after this succeeds, so a failed insert leaves the document consistent.
      const { error: chunkError } = await this.supabase.from('clinic_ai_knowledge').insert(chunkRows);
      if (chunkError) throw chunkError;

      // Update document status to indexed and record chunk count + indexed_at
      await this.supabase
        .from('clinic_knowledge_documents')
        .update({
          processing_status: 'indexed',
          chunk_count: chunks.length,
          indexed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
    } catch (error) {
      console.error(`Error in processDocument for test harness: ${documentId}`, error);
      // Mark the document as failed so it doesn't stay stuck in "pending"
      await this.supabase
        .from('clinic_knowledge_documents')
        .update({ processing_status: 'failed' })
        .eq('id', documentId);
      throw error;
    }
  }

  async deleteDocument(documentId: string, clinicId: string) {
    // First, get the document to ensure it belongs to the clinic and to get its storage path.
    const { data: document, error: docError } = await this.supabase
      .from('clinic_knowledge_documents')
      .select('storage_path, clinic_id')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found.');
    }

    if (document.clinic_id !== clinicId) {
      throw new Error('Forbidden: Document does not belong to this clinic.');
    }

    // 1. Soft delete the document record first.
    await this.supabase.from('clinic_knowledge_documents').update({ deleted_at: new Date().toISOString() }).eq('id', documentId);

    // 2. Delete associated chunks from the knowledge base.
    await this.supabase.from('clinic_ai_knowledge').delete().eq('document_id', documentId);

    // 3. Delete the file from storage.
    if (document.storage_path) {
      await this.supabase.storage.from('knowledge_documents').remove([document.storage_path]);
    }
  }

  async reindexDocument(documentId: string, clinicId: string) {
    const { data: document, error: docError } = await this.supabase.from('clinic_knowledge_documents').select('storage_path, clinic_id').eq('id', documentId).single();
    if (docError || !document) throw new Error('Document not found.');
    if (document.clinic_id !== clinicId) throw new Error('Forbidden: Document does not belong to this clinic.');

    await this.supabase.from('clinic_ai_knowledge').delete().eq('document_id', documentId);

    const { data: updatedDoc, error: updateError } = await this.supabase.from('clinic_knowledge_documents').update({ processing_status: 'pending', chunk_count: null, indexed_at: null, deleted_at: null }).eq('id', documentId).select().single();
    if (updateError) throw new Error(`Failed to reset document status: ${updateError.message}`);

    if (!document.storage_path) throw new Error('Document has no storage path and cannot be re-indexed.');
    await this.supabase.functions.invoke('process-document', { body: { documentId, storagePath: document.storage_path } });

    return updatedDoc;
  }
}