import { vectorSearchClinic } from '@/lib/services/knowledge/retrieval';

/**
 * Retrieves context from the knowledge base relevant to the user's query.
 * @param clinicId The ID of the clinic.
 * @param text The user's query text.
 * @param k The number of documents to retrieve (not used here, handled in vectorSearchClinic).
 * @returns A promise that resolves to an array of context chunks.
 */
export async function retrieveContext(clinicId: string, text: string, k: number) {
  // The 'k' parameter from the orchestrator is ignored in favor of the
  // constants defined within the vectorSearchClinic service.
  return await vectorSearchClinic(clinicId, text);
}