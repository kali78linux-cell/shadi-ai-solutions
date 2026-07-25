import { SupabaseClient } from '@supabase/supabase-js';
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

    // Asynchronously process the document. In a real app, this would be a background job.
    this.processDocument(docData.id, file);

    return docData as ClinicKnowledgeDocument;
  }

  async processDocument(documentId: string, file: File) {
    try {
      await this.updateDocumentStatus(documentId, 'processing');
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const content = await extractTextFromBuffer(fileBuffer, file.name);

      await this.updateDocumentStatus(documentId, 'chunking');
      const chunks = chunkText(content);

      await this.updateDocumentStatus(documentId, 'embedding');
      const provider = getProvider();
      const clinicId = (await this.supabase.from('clinic_knowledge_documents').select('clinic_id').eq('id', documentId).single()).data?.clinic_id;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await provider.generateEmbedding(chunk);
        const { error: chunkError } = await this.supabase.from('clinic_ai_knowledge').insert({
          document_id: documentId,
          clinic_id: clinicId,
          type: 'unstructured',
          content: chunk,
          chunk_index: i,
          embedding_vector: embedding, // Use the new vector column
        });
        if (chunkError) throw chunkError;
      }

      await this.supabase.from('clinic_knowledge_documents').update({ processing_status: 'indexed', chunk_count: chunks.length, indexed_at: new Date().toISOString() }).eq('id', documentId);
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);
      await this.updateDocumentStatus(documentId, 'error');
    }
  }

  private async updateDocumentStatus(documentId: string, status: ClinicKnowledgeDocument['processing_status']) {
    await this.supabase.from('clinic_knowledge_documents').update({ processing_status: status }).eq('id', documentId);
  }
}