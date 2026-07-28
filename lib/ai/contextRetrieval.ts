import { vectorSearchClinic } from '@/lib/services/knowledge/retrieval';
import { rankAndFilterResults } from '@/lib/services/knowledge/ranking';

/**
 * Retrieves context from the knowledge base relevant to the user's query.
 * @param clinicId The ID of the clinic.
 * @param text The user's query text.
 * @param k The number of documents to retrieve (not used here, handled in vectorSearchClinic).
 * @returns A promise that resolves to an array of context chunks.
 */
export async function retrieveContext(clinicId: string, text: string, k: number) {
  const initialResults = await vectorSearchClinic(clinicId, text);
  const rankedResults = rankAndFilterResults(initialResults);
  // The 'k' parameter from the orchestrator can be used here to limit the final results if needed.
  return rankedResults.slice(0, k);
}