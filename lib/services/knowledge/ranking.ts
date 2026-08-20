import { RetrievalResult } from './retrieval';
import {
  Entity,
  buildEntityRegistry,
  extractQueryEntities,
  computeEntityBoost,
} from './entities';

const MIN_SIMILARITY_THRESHOLD = 0.8;
/** Lower bar for keyword-only results when vector search is unavailable
 *  (e.g. local Ollama without an embedding model). */
const MIN_KEYWORD_THRESHOLD = 0.35;

/**
 * Maximum boost a single FAQ chunk can receive from matching the query.
 * Set lower than entity boost to avoid overwhelming semantic relevance.
 */
const MAX_FAQ_BOOST = 0.2;

/**
 * Computes an FAQ boost score for a retrieval result.
 *
 * A chunk gets a boost if:
 * 1. It is a FAQ chunk (subtype === 'faq')
 * 2. Its title or content directly matches tokens in the user query
 *
 * The boost is proportional to the overlap between the query and the
 * FAQ title/content, capped at MAX_FAQ_BOOST to ensure it enhances
 * but does not override semantic relevance.
 *
 * @param result The retrieval result to score.
 * @param query The user's query text.
 * @returns A boost score in range [0, MAX_FAQ_BOOST].
 */
export function computeFAQBoost(result: RetrievalResult, query: string): number {
  if (!query || !query.trim()) {
    return 0;
  }

  // Only boost FAQ chunks
  if (result.subtype !== 'faq') {
    return 0;
  }

  const queryLower = query.toLowerCase().trim();
  const queryTokens = (
    queryLower
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );

  if (queryTokens.length === 0) {
    return 0;
  }

  // Gather text to match against: title + content
  const matchTextParts: string[] = [];
  if (result.title) matchTextParts.push(result.title.toLowerCase());
  if (result.content) matchTextParts.push(result.content.toLowerCase());

  if (matchTextParts.length === 0) {
    return 0;
  }

  const matchText = matchTextParts.join(' ');

  // Count how many query tokens appear in the FAQ text
  let matchedCount = 0;
  for (const token of queryTokens) {
    if (matchText.includes(token)) {
      matchedCount++;
    }
  }

  if (matchedCount === 0) {
    return 0;
  }

  // Boost = (matchedTokens / totalQueryTokens) * MAX_FAQ_BOOST
  const overlapRatio = matchedCount / queryTokens.length;
  const boost = overlapRatio * MAX_FAQ_BOOST;

  return Math.min(MAX_FAQ_BOOST, boost);
}

/**
 * Ranks and filters retrieval results to select the best context.
 *
 * Pipeline:
 * 1. Filter out low-confidence results (below MIN_SIMILARITY_THRESHOLD on raw similarity).
 * 2. Build an entity registry from the results (dynamic, no hardcoded lists).
 * 3. Extract entities from the user query that match the registry.
 * 4. Compute a rankingScore for each result:
 *    rankingScore = (existing rankingScore or similarity)
 *                 + entityBoost
 *                 + faqBoost
 * 5. Remove duplicates based on content, keeping the highest-scoring copy.
 * 6. Sort by rankingScore in descending order.
 *
 * The original `similarity` field is NEVER overwritten — it remains the raw
 * vector similarity (embedding distance) from the search.
 *
 * @param results The initial retrieval results from vector search.
 * @param query The user's query text (used for entity boosting and FAQ boosting).
 * @param entityRegistry Optional pre-built entity registry. If not provided,
 *   one is built from the results.
 * @returns A sorted and filtered array of the most relevant results.
 */
export function rankAndFilterResults(
  results: RetrievalResult[],
  query: string = '',
  entityRegistry?: Entity[]
): RetrievalResult[] {
  if (!results || results.length === 0) {
    return [];
  }

  // 1. Filter out low-confidence results (on raw similarity — preserved).
  //    When vector search is unavailable (e.g. local Ollama without an
  //    embedding model), keyword-only results have similarity 0 but carry
  //    a keywordScore. Use that as the fallback confidence to keep RAG working.
  const highConfidenceResults = results.filter((result) => {
    if (result.similarity > 0) {
      return result.similarity >= MIN_SIMILARITY_THRESHOLD;
    }
    return (result.keywordScore ?? 0) >= MIN_KEYWORD_THRESHOLD;
  });

  // 2. Build entity registry if not provided
  const registry = entityRegistry ?? buildEntityRegistry(highConfidenceResults);

  // 3. Extract query entities
  const queryEntities = query ? extractQueryEntities(query, registry) : [];

  // 4. Compute rankingScore for each result
  const scoredResults = highConfidenceResults.map((result) => {
    const entityBoost = computeEntityBoost(result, queryEntities, registry);
    const faqBoost = computeFAQBoost(result, query);
    // rankingScore = base score (existing rankingScore, raw similarity,
    // or keywordScore for keyword-only results) + boosts
    const baseScore = result.rankingScore ?? result.similarity ?? result.keywordScore ?? 0;
    const rankingScore = Math.min(1, baseScore + entityBoost + faqBoost);
    const confidenceScore = computeConfidenceScore({ ...result, rankingScore }, highConfidenceResults.length);
    return {
      ...result,
      rankingScore,
      confidenceScore,
    };
  });

  // 5. Remove duplicates based on content, keeping the highest rankingScore
  const dedupMap = new Map<string, RetrievalResult>();
  for (const item of scoredResults) {
    const key = item.content ?? '';
    const existing = dedupMap.get(key);
    if (!existing || (item.rankingScore ?? 0) > (existing.rankingScore ?? 0)) {
      dedupMap.set(key, item);
    }
  }

  // 6. Sort by rankingScore in descending order (NOT similarity)
  const sortedResults = Array.from(dedupMap.values()).sort(
    (a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0)
  );

  return sortedResults;
}

/**
 * Computes a confidence score for a retrieval result.
 * The score is a normalized value between 0 and 1 that combines
 * the ranking score with a penalty for low result counts.
 *
 * Uses `rankingScore` if available (which includes entity boosting and FAQ boosting),
 * falling back to the raw `similarity` for backward compatibility.
 *
 * @param result The retrieval result.
 * @param totalResults The total number of results in the initial set.
 * @returns A confidence score between 0 and 1.
 */
export function computeConfidenceScore(result: RetrievalResult, totalResults: number): number {
  // Use rankingScore if available, fall back to similarity.
  // For keyword-only results (no vector search available), use keywordScore
  // as the base so RAG still works with local providers.
  const baseScore = result.rankingScore ?? result.similarity ?? result.keywordScore ?? 0;
  // Normalize: if we have many results, the top ones are more trustworthy.
  // If we have few results, we penalize slightly.
  const countFactor = Math.min(1, totalResults / 5);
  return Math.min(1, baseScore * (0.7 + 0.3 * countFactor));
}
