import { hybridSearchClinic, RetrievalResult, RetrievalOptions, getDocumentMetadata } from '@/lib/services/knowledge/retrieval';
import { rankAndFilterResults } from '@/lib/services/knowledge/ranking';
import { assembleContext, AssembledContext, ContextChunk } from '@/lib/services/knowledge/contextAssembly';
import { detectLanguage, generateQueryVariants, getRetrievalLanguage } from '@/lib/services/knowledge/multilingual';
import { logEvent } from '@/lib/server/logging';
import { getProvider } from '@/lib/ai/provider';

/**
 * Cache entry for retrieval results.
 */
interface CacheEntry {
  results: RetrievalResult[];
  timestamp: number;
}

/**
 * In-memory cache for retrieval results.
 * Keyed by `${clinicId}:${query}`.
 * TTL: 5 minutes.
 */
const retrievalCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clears the retrieval cache. Useful for testing.
 */
export function clearRetrievalCache(): void {
  retrievalCache.clear();
}

/**
 * Retrieves and assembles context from the knowledge base relevant to the user's query.
 *
 * Pipeline:
 * 1. Detect language and generate query variants for multilingual support.
 * 2. Check cache for existing results.
 * 3. Perform hybrid search (vector similarity + keyword matching) with language-aware options.
 * 4. Rank and filter results by confidence.
 * 5. Assemble context with deduplication, hierarchy, and token limits.
 * 6. Cache results for future queries.
 *
 * @param clinicId The ID of the clinic.
 * @param text The user's query text.
 * @param k The number of top results to retrieve.
 * @param maxTokens The maximum number of tokens for the assembled context.
 * @returns A promise that resolves to the assembled context with citations.
 */
/**
 * Returns the effective confidence threshold for context assembly.
 * When the active provider has no embedding support (e.g. local Ollama),
 * keyword-only retrieval scores are naturally lower, so a lower bar
 * ensures RAG content still reaches the LLM.
 */
function getEffectiveConfidenceThreshold(configured: number): number {
  try {
    const provider = getProvider();
    if (provider && !provider.embed) {
      return Math.min(configured, 0.45);
    }
  } catch {
    // If provider registry fails, keep the configured threshold.
  }
  return configured;
}

export async function retrieveContext(
  clinicId: string,
  text: string,
  k: number = 5,
  maxTokens: number = 2000,
  confidenceThreshold: number = 0.7
): Promise<AssembledContext> {
  // 1. Detect language and generate query variants
  const language = getRetrievalLanguage(text);
  const queryVariants = generateQueryVariants(text);

  // 2. Check cache
  const cacheKey = `${clinicId}:${text}`;
  const cached = retrievalCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logEvent('retrieval_cache_hit', { clinic_id: clinicId, query: text });
    const effectiveThreshold = getEffectiveConfidenceThreshold(confidenceThreshold);
    return assembleContext(cached.results, maxTokens, effectiveThreshold);
  }

  // 3. Perform hybrid search with all query variants
  const allResults: RetrievalResult[] = [];
  for (const variant of queryVariants) {
    const options: RetrievalOptions = {
      topK: k,
      language,
    };
    const results = await hybridSearchClinic(clinicId, variant, options);
    // Map results for compatibility with ranking/assembly.
    // NOTE: Do NOT set `rankingScore` to the hybrid score when the
    // result is keyword-only (similarity=0). The hybrid score is
    // keywordScore * keywordWeight which underestimates the actual
    // keyword match strength. Keep the original keywordScore so the
    // confidence pipeline can use it as the base score.
    const mappedResults = results.map((r) => {
      if (r.similarity > 0) {
        // Vector-capable path: keep raw similarity AND ordering by hybrid.
        return {
          ...r,
          similarity: r.similarity,
          rankingScore: r.hybridScore,
        };
      }
      // Keyword-only path: expose the keywordScore directly; set
      // rankingScore to a strong estimated value so ordering favors
      // strong keyword matches even without vector scores.
      return {
        ...r,
        similarity: 0, // preserved raw vector score (none available)
        rankingScore: r.keywordScore ?? 0,
      };
    });
    allResults.push(...mappedResults);
  }

  // 4. Deduplicate by ID (same chunk may appear from multiple query variants)
  const uniqueById = new Map<string, RetrievalResult>();
  for (const result of allResults) {
    const existing = uniqueById.get(result.id);
    if (!existing || (result.rankingScore ?? result.similarity) > (existing.rankingScore ?? existing.similarity)) {
      uniqueById.set(result.id, result);
    }
  }
  const documentIds = Array.from(uniqueById.values())
    .map((result) => result.document_id)
    .filter((documentId): documentId is string => Boolean(documentId));
  const documentMetadata = await getDocumentMetadata(documentIds);
  const uniqueResults = Array.from(uniqueById.values()).map((result) => ({
    ...result,
    document: result.document || (result.document_id ? documentMetadata[result.document_id] || null : null),
  }));

  // 5. Rank and filter
  const rankedResults = rankAndFilterResults(uniqueResults, text);

  // 6. Cache results
  retrievalCache.set(cacheKey, { results: rankedResults, timestamp: Date.now() });

  // 7. Assemble context with citations.
  //    When embeddings are unavailable (e.g. local Ollama), lower the
  //    effective threshold so keyword-only results can reach the LLM.
  const effectiveThreshold = getEffectiveConfidenceThreshold(confidenceThreshold);
  const assembled = assembleContext(rankedResults, maxTokens, effectiveThreshold);

  logEvent('retrieval_completed', {
    clinic_id: clinicId,
    query: text,
    language,
    results_count: rankedResults.length,
    context_tokens: assembled.totalTokens,
    truncated: assembled.truncated,
  });

  return assembled;
}

/**
 * Retrieves context and returns a simple array of context chunks
 * (for backward compatibility with existing callers).
 *
 * @deprecated Use `retrieveContext` for full context assembly with citations.
 */
export async function retrieveContextChunks(clinicId: string, text: string, k: number = 5): Promise<ContextChunk[]> {
  const assembled = await retrieveContext(clinicId, text, k);
  return assembled.chunks;
}
