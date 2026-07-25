import type { AIProvider } from '@/lib/ai/provider';
import { registerProvider, clearProviders } from '@/lib/ai/provider';
import type { ClinicKnowledgeDocument, ClinicAIKnowledge } from '@/types/db';

export function createKnowledgeTestHarness() {
  clearProviders();

  const documentStore: ClinicKnowledgeDocument[] = [];
  const chunkStore: ClinicAIKnowledge[] = [];

  const provider: AIProvider = {
    id: 'openai',
    generate: async ({ prompt }) => ({ text: prompt, tokens: prompt.length }),
    embed: async (input: string) => ({
      embedding: Array.from({ length: 1536 }, (_, index) => {
        const char = input.charCodeAt(index % input.length) || 97;
        return ((char + index) % 10) / 10;
      }),
    }),
  };

  registerProvider(provider);

  const fakeSupabase = {
    from(table: string) {
      if (table === 'clinic_knowledge_documents') {
        return {
          insert(rows: any[]) {
            const doc = { ...rows[0], id: `doc-${documentStore.length + 1}`, created_at: new Date().toISOString() };
            documentStore.push(doc);
            return {
              select: () => ({
                single: () => ({ data: doc, error: null }),
              }),
            };
          },
          update(values: Partial<ClinicKnowledgeDocument>) {
            return {
              eq: (field: string, value: string) => {
                const doc = documentStore.find((d) => (d as any)[field] === value);
                if (doc) Object.assign(doc, values);
                return { data: null, error: null };
              },
            };
          },
        };
      }

      if (table === 'clinic_ai_knowledge') {
        return {
          insert(rows: any[]) {
            const inserted = rows.map((row, i) => ({
              ...row,
              id: `chunk-${chunkStore.length + i + 1}`,
            })) as ClinicAIKnowledge[];
            chunkStore.push(...inserted);
            return {
              select: () => ({ data: inserted, error: null }),
            };
          },
          update(values: Partial<ClinicAIKnowledge>) {
            return {
              eq: (field: string, value: string) => {
                const chunk = chunkStore.find((c) => (c as any)[field] === value);
                if (chunk) Object.assign(chunk, values);
                return { data: null, error: null };
              },
            };
          },
        };
      }

      throw new Error(`Test harness does not support table: ${table}`);
    },
  };

  return {
    provider,
    documentStore,
    chunkStore,
    supabase: fakeSupabase,
    getChunksForClinic(clinicId: string) {
      return chunkStore.filter((row) => row.clinic_id === clinicId);
    },
    getDocumentsForClinic(clinicId: string) {
      return documentStore.filter((row) => row.clinic_id === clinicId);
    },
    dispose() {
      documentStore.length = 0;
      chunkStore.length = 0;
      clearProviders();
    },
    search(clinicId: string, embedding: number[], topK = 5) {
      const rows = this.getChunksForClinic(clinicId);
      return rows
        .filter((row) => Array.isArray(row.embedding) && row.embedding.length > 0)
        .map((row) => ({ ...row, score: row.embedding!.reduce((sum, value, index) => sum + value * (embedding[index] || 0), 0) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, topK);
    },
  };
}
