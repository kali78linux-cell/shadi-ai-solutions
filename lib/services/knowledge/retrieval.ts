import { vectorSearchClinic } from '@/lib/services/knowledgeService';

export async function retrieveTopK(clinicId: string, embedding: number[], k = 5) {
  return await vectorSearchClinic(clinicId, embedding, k);
}
