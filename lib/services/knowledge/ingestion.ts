import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';
import { parseFileBuffer } from './parser';
import { embedText } from './embeddings';

export type KnowledgeTestDeps = {
  supabaseClient?: any;
  embedTextFn?: typeof embedText;
};

export async function ingestDocumentBuffer(clinicId: string, buffer: Buffer, filename?: string, uploadedBy?: string | null, metadata?: Record<string, any>, deps?: KnowledgeTestDeps) {
  const client = deps?.supabaseClient ?? supabase;
  const embedFn = deps?.embedTextFn ?? embedText;

  // validate size
  if (buffer.length > 10 * 1024 * 1024) throw new Error('File too large (max 10MB)');

  const chunks = await parseFileBuffer(buffer, filename);
  if (!chunks.length) return [];

  const rows: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    rows.push({ clinic_id: clinicId, type: 'unstructured', subtype: 'document', title: filename || `doc_${Date.now()}`, content: chunks[i], chunk_index: i, source_type: 'upload', metadata: { filename, uploaded_by: uploadedBy, ...metadata } });
  }

  const { data, error } = await client.from('clinic_ai_knowledge').insert(rows).select('*');
  if (error) throw error;

  // generate embeddings and update
  for (const row of data) {
    try {
      const emb = await embedFn(row.content || '');
      await client.from('clinic_ai_knowledge').update({ embedding: emb, metadata: { ...row.metadata, embedding: emb } }).eq('id', row.id);
    } catch (e) {
      logEvent('embedding_failure', { clinic_id: clinicId, row_id: row.id, error: e instanceof Error ? { name: e.name, message: e.message } : String(e) }, 'error');
    }
  }

  return data;
}

export async function ingestStructured(clinicId: string, subtype: string, items: Array<Record<string, any>>, uploadedBy?: string | null, deps?: KnowledgeTestDeps) {
  const client = deps?.supabaseClient ?? supabase;
  const embedFn = deps?.embedTextFn ?? embedText;

  const rows: any[] = [];
  for (const it of items) {
    const title = it.name || it.title || subtype;
    const content = JSON.stringify(it);
    const chunks = content.match(/.{1,800}/g) || [content];
    for (let i = 0; i < chunks.length; i++) {
      rows.push({ clinic_id: clinicId, type: 'structured', subtype, title, content: chunks[i], chunk_index: i, source_type: 'structured', structured_data: it, metadata: { uploaded_by: uploadedBy } });
    }
  }

  if (!rows.length) return [];
  const { data, error } = await client.from('clinic_ai_knowledge').insert(rows).select('*');
  if (error) throw error;

  for (const row of data) {
    try {
      const emb = await embedFn(row.content || '');
      await client.from('clinic_ai_knowledge').update({ embedding: emb, metadata: { ...row.metadata, embedding: emb } }).eq('id', row.id);
    } catch (e) {
      logEvent('embedding_failure', { clinic_id: clinicId, row_id: row.id, error: e instanceof Error ? { name: e.name, message: e.message } : String(e) }, 'error');
    }
  }

  return data;
}
