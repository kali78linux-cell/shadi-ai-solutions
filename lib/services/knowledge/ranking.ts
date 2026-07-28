import { RetrievalResult } from './retrieval';

const MIN_SIMILARITY_THRESHOLD = 0.8;

/**
 * Ranks and filters retrieval results to select the best context.
 * @param results The initial retrieval results from vector search.
 * @returns A sorted and filtered array of the most relevant results.
 */
export function rankAndFilterResults(results: RetrievalResult[]): RetrievalResult[] {
  if (!results || results.length === 0) {
    return [];
  }

  // 1. Filter out low-confidence results
  const highConfidenceResults = results.filter(
    (result) => result.similarity >= MIN_SIMILARITY_THRESHOLD
  );

  // 2. Remove duplicates based on content
  const uniqueResults = Array.from(
    new Map(highConfidenceResults.map((item) => [item.content, item])).values()
  );

  // 3. Sort by similarity score in descending order
  const sortedResults = uniqueResults.sort(
    (a, b) => b.similarity - a.similarity
  );

  return sortedResults;
}