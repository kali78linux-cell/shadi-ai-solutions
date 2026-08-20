import { supabaseAdmin } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/ai/provider';
import { logEvent } from '@/lib/server/logging';
import { ClinicAIKnowledge, ClinicKnowledgeDocument } from '@/types/db';

const MATCH_THRESHOLD = 0.78;
const MATCH_COUNT = 5;

/**
 * A single retrieval result returned by the vector search.
 * Extends the raw `clinic_ai_knowledge` row with a similarity score
 * and an optional joined document reference for citations.
 */
export interface RetrievalResult {
  id: string;
  document_id: string | null;
  chunk_index: number | null;
  content: string | null;
  /** Raw vector similarity from the embedding search. NEVER overwritten. */
  similarity: number;
  /** Composite ranking score used for ordering. Combines similarity,
   *  keyword relevance, and entity boosting. */
  rankingScore?: number;
  /** Calibrated confidence assigned by the ranking pipeline. */
  confidenceScore?: number;
  /** Keyword relevance score (separate from similarity). */
  keywordScore?: number;
  type: 'structured' | 'unstructured';
  subtype?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Structured data payload for structured-type chunks. */
  structured_data?: Record<string, unknown> | null;
  language?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Joined document metadata for source citations. */
  document?: {
    id: string;
    original_filename: string;
    file_type: string;
    mime_type: string;
  } | null;
  /** Optional source location metadata carried from ingestion without schema changes. */
  page_number?: number | null;
}


/**
 * A hybrid search result that combines vector similarity and keyword matching scores.
 */
export interface HybridSearchResult extends RetrievalResult {
  vectorScore: number;
  keywordScore: number;
  hybridScore: number;
}


/**
 * Options for a retrieval query.
 */
export interface RetrievalOptions {
  /** Maximum number of results to return (top-k). */
  topK?: number;

  /** Minimum similarity score threshold (0–1). */
  minScore?: number;
  /** Optional metadata filters (e.g. { type: 'structured', subtype: 'services' }). */
  filters?: Record<string, unknown>;
  /** Optional language filter (e.g. 'en', 'ar'). */
  language?: string;
}

/**
 * Performs a vector search for a given query within a specific clinic's knowledge base.
 *
 * Pipeline:
 * 1. Generate an embedding for the user's query via the configured AI provider.
 * 2. Call the Supabase RPC `match_clinic_documents` to find matching chunks.
 * 3. Apply metadata filtering, language filtering, and top-k limiting.
 * 4. Attach confidence scores and document metadata for citations.
 *
 * @param clinicId The ID of the clinic to search within.
 * @param query The user's query text.
 * @param options Optional retrieval parameters (topK, minScore, filters, language).
 * @returns A promise that resolves to an array of matching knowledge chunks with confidence scores.
 */
export async function vectorSearchClinic(
  clinicId: string,
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievalResult[]> {
  const provider = getProvider();
  if (!provider.embed) {
    logEvent('retrieval_error', { clinic_id: clinicId, error: 'AI provider does not support embeddings.' }, 'error');
    throw new Error('The configured AI provider does not support embeddings.');
  }

  const {
    topK = MATCH_COUNT,
    minScore = MATCH_THRESHOLD,
    filters = {},
    language,
  } = options;

  // 1. Generate embedding for the user's query.
  const { embedding } = await provider.embed(query);

  // 2. Call the Supabase RPC function to find matching documents.
  const { data: chunks, error } = await supabaseAdmin.rpc('match_clinic_documents', {
    p_clinic_id: clinicId,
    p_query_embedding: embedding,
    p_match_threshold: minScore,
    p_match_count: topK,
  });

  if (error) {
    logEvent('retrieval_error', { clinic_id: clinicId, error: `RPC match_clinic_documents failed: ${error.message}` }, 'error');
    console.error('Error matching documents:', error);
    return [];
  }

  if (!chunks || chunks.length === 0) {
    return [];
  }

  // 3. Apply metadata filtering (post-filter on structured fields).
  let filtered = chunks as RetrievalResult[];
  if (Object.keys(filters).length > 0) {
    filtered = filtered.filter((chunk) => {
      return Object.entries(filters).every(([key, value]) => {
        if (key === 'type' || key === 'subtype' || key === 'title') {
          return chunk[key as keyof RetrievalResult] === value;
        }
        if (key === 'metadata') {
          const chunkMeta = chunk.metadata || {};
          return Object.entries(value as Record<string, unknown>).every(
            ([mk, mv]) => (chunkMeta as Record<string, unknown>)[mk] === mv
          );
        }
        return true;
      });
    });
  }

  // 4. Apply language filtering.
  if (language) {
    filtered = filtered.filter((chunk) => {
      const chunkLang = chunk.language || 'unknown';
      return chunkLang === language || chunkLang === 'unknown';
    });
  }

  // 5. Ensure confidence scores are present (the RPC should return similarity).
  filtered = filtered.map((chunk) => ({
    ...chunk,
    similarity: chunk.similarity ?? 0,
  }));

  return filtered;
}

/**
 * Performs a keyword-based search for a given query within a specific clinic's knowledge base.
 *
 * Uses ILIKE-based term matching on the `content` column to find chunks that
 * contain the query terms. This complements vector search by catching exact
 * keyword matches that may have lower semantic similarity.
 *
 * @param clinicId The ID of the clinic to search within.
 * @param query The user's query text.
 * @param options Optional retrieval parameters (topK, filters, language).
 * @returns A promise that resolves to an array of matching knowledge chunks with keyword relevance scores.
 */
export async function keywordSearchClinic(
  clinicId: string,
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievalResult[]> {
  const {
    topK = MATCH_COUNT,
    filters = {},
    language,
  } = options;

  // Extract meaningful search terms (length > 2 to avoid noise).
  // Strip diacritics/punctuation (؟،؟!, etc.) so Arabic terms
  // match the stored content correctly.
  const terms = query
    .toLowerCase()
    .replace(/[،،؟?!.,;:'"()\[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) {
    return [];
  }

  // Build OR conditions for each search term using ILIKE
  const ilikeConditions = terms.map((t) => `content.ilike.%${t}%`).join(',');

  let queryBuilder = supabaseAdmin
    .from('clinic_ai_knowledge')
    .select('*')
    .eq('clinic_id', clinicId)
    .or(ilikeConditions)
    .order('created_at', { ascending: false })
    .limit(topK * 3);

  // Apply metadata filters
  if (Object.keys(filters).length > 0) {
    for (const [key, value] of Object.entries(filters)) {
      if (key === 'type' || key === 'subtype' || key === 'title') {
        queryBuilder = queryBuilder.eq(key, value as string);
      }
    }
  }

  const { data: chunks, error } = await queryBuilder;

  if (error) {
    logEvent('retrieval_error', { clinic_id: clinicId, error: `Keyword search failed: ${error.message}` }, 'error');
    console.error('Error in keyword search:', error);
    return [];
  }

  if (!chunks || chunks.length === 0) {
    return [];
  }

  let filtered = chunks as RetrievalResult[];

  // Apply language filtering.
  // NOTE: The `language` column may not exist in the actual table.
  // When it's missing, `chunk.language` is undefined → treat as 'unknown'
  // and allow the chunk through (no language metadata = no filtering).
  if (language) {
    filtered = filtered.filter((chunk) => {
      const chunkLang = chunk.language || 'unknown';
      return chunkLang === language || chunkLang === 'unknown';
    });
  }

  // Compute keyword relevance score based on term frequency.
  // NOTE: similarity is preserved (raw vector distance); keywordScore is separate.
  filtered = filtered.map((chunk) => {
    const content = (chunk.content || '').toLowerCase();
    const matchedTerms = terms.filter((t) => content.includes(t));
    const keywordScore = matchedTerms.length / terms.length;
    return {
      ...chunk,
      keywordScore,
    };
  });

  return filtered;

}

/**
 * Performs a hybrid search combining vector similarity and keyword matching.
 *
 * Pipeline:
 * 1. Run vector search and keyword search in parallel.
 * 2. Merge results by chunk ID, combining scores with configurable weights.
 * 3. Sort by hybrid score and return top-k results.
 *
 * The hybrid score is computed as:
 *   hybridScore = vectorScore * vectorWeight + keywordScore * keywordWeight
 *
 * @param clinicId The ID of the clinic to search within.
 * @param query The user's query text.
 * @param options Optional retrieval parameters (topK, minScore, filters, language).
 * @param vectorWeight Weight for the vector similarity score (default: 0.7).
 * @param keywordWeight Weight for the keyword relevance score (default: 0.3).
 * @returns A promise that resolves to an array of hybrid search results.
 */
export async function hybridSearchClinic(
  clinicId: string,
  query: string,
  options: RetrievalOptions = {},
  vectorWeight = 0.7,
  keywordWeight = 0.3
): Promise<HybridSearchResult[]> {
  const { topK = MATCH_COUNT, minScore = MATCH_THRESHOLD, filters = {}, language } = options;

  // Run both searches in parallel.
  // If the provider does not support embeddings (e.g. Ollama without an
  // embedding model), vector search gracefully falls back to keyword-only.
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearchClinic(clinicId, query, { topK: topK * 2, minScore, filters, language }).catch(() => []),
    keywordSearchClinic(clinicId, query, { topK: topK * 2, filters, language }),
  ]);

  // Merge results by ID
  const merged = new Map<string, HybridSearchResult>();

  for (const result of vectorResults) {
    merged.set(result.id, {
      ...result,
      vectorScore: result.similarity,
      keywordScore: 0,
      hybridScore: result.similarity * vectorWeight,
    });
  }

  for (const result of keywordResults) {
    const existing = merged.get(result.id);
    if (existing) {
      existing.keywordScore = result.keywordScore ?? 0;
      existing.hybridScore = existing.vectorScore * vectorWeight + (result.keywordScore ?? 0) * keywordWeight;
    } else {
      merged.set(result.id, {
        ...result,
        vectorScore: 0,
        keywordScore: result.keywordScore ?? 0,
        hybridScore: (result.keywordScore ?? 0) * keywordWeight,
      });
    }
  }
  // Sort by hybrid score descending and return top-k
  return Array.from(merged.values())
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, topK);
}

/**
 * Retrieves document metadata for a set of chunk results, enabling source citations.
 * @param documentIds The set of document IDs to look up.
 * @returns A map of document ID to document metadata.
 */
export async function getDocumentMetadata(documentIds: string[]): Promise<Record<string, { id: string; original_filename: string; file_type: string; mime_type: string }>> {
  if (documentIds.length === 0) return {};

  const { data, error } = await supabaseAdmin
    .from('clinic_knowledge_documents')
    .select('id, original_filename, file_type, mime_type')
    .in('id', documentIds);

  if (error) {
    logEvent('retrieval_error', { error: `Failed to fetch document metadata: ${error.message}` }, 'error');
    return {};
  }

  const map: Record<string, { id: string; original_filename: string; file_type: string; mime_type: string }> = {};
  for (const doc of (data || []) as ClinicKnowledgeDocument[]) {
    map[doc.id] = {
      id: doc.id,
      original_filename: doc.original_filename,
      file_type: doc.file_type,
      mime_type: doc.mime_type,
    };
  }
  return map;
}
