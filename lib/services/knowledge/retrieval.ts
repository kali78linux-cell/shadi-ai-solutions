import { supabase } from '@/lib/supabase';
import { getProvider } from '@/lib/ai/provider';
import { logEvent } from '@/lib/server/logging';

const MATCH_THRESHOLD = 0.78;
const MATCH_COUNT = 5;

/**
 * Performs a vector search for a given query within a specific clinic's knowledge base.
 * @param clinicId The ID of the clinic to search within.
 * @param query The user's query text.
 * @returns A promise that resolves to an array of matching knowledge chunks.
 */
export async function vectorSearchClinic(clinicId: string, query: string) {
  const provider = getProvider();
  if (!provider.embed) {
    logEvent('retrieval_error', { clinic_id: clinicId, error: 'AI provider does not support embeddings.' }, 'error');
    throw new Error('The configured AI provider does not support embeddings.');
  }

  // 1. Generate embedding for the user's query.
  const { embedding } = await provider.embed(query);

  // 2. Call the Supabase RPC function to find matching documents.
  const { data: chunks, error } = await supabase.rpc('match_clinic_documents', {
    p_clinic_id: clinicId,
    p_query_embedding: embedding,
    p_match_threshold: MATCH_THRESHOLD,
    p_match_count: MATCH_COUNT,
  });

  if (error) {
    logEvent('retrieval_error', { clinic_id: clinicId, error: `RPC match_clinic_documents failed: ${error.message}` }, 'error');
    console.error('Error matching documents:', error);
    return [];
  }

  return chunks;
}
