import { describe, expect, it } from 'vitest';
import { assembleContext } from '@/lib/services/knowledge/contextAssembly';
import type { RetrievalResult } from '@/lib/services/knowledge/retrieval';

function result(overrides: Partial<RetrievalResult>): RetrievalResult {
  return {
    id: 'chunk-1',
    document_id: 'doc-1',
    chunk_index: 0,
    content: 'The clinic accepts the treatment.',
    similarity: 0.9,
    rankingScore: 0.9,
    type: 'unstructured',
    document: {
      id: 'doc-1',
      original_filename: 'clinic-faq.pdf',
      file_type: 'pdf',
      mime_type: 'application/pdf',
    },
    ...overrides,
  };
}

describe('Production context assembly', () => {
  it('preserves source attribution and confidence for every assembled chunk', () => {
    const assembled = assembleContext([
      result({ page_number: 4, confidenceScore: 0.88 }),
    ], 2000, 0.7);

    expect(assembled.hasSufficientContext).toBe(true);
    expect(assembled.chunks[0].citation).toMatchObject({
      documentId: 'doc-1',
      filename: 'clinic-faq.pdf',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      pageNumber: 4,
      confidenceScore: 0.88,
    });
    expect(assembled.chunks[0].result?.content).toContain('accepts');
  });

  it('removes duplicate content and respects the token budget', () => {
    const assembled = assembleContext([
      result({ id: 'best', confidenceScore: 0.95 }),
      result({ id: 'duplicate', confidenceScore: 0.8 }),
      result({ id: 'later', content: 'A separate short fact.', confidenceScore: 0.7 }),
    ], 8, 0.6);

    expect(assembled.chunks.map((chunk) => chunk.citation.chunkId)).not.toContain('duplicate');
    expect(assembled.totalTokens).toBeLessThanOrEqual(8);
    expect(assembled.truncated).toBe(true);
  });

  it('marks low-confidence context as insufficient', () => {
    const assembled = assembleContext([
      result({ confidenceScore: 0.42 }),
    ], 2000, 0.7);

    expect(assembled.hasSufficientContext).toBe(false);
    expect(assembled.citations[0].confidenceScore).toBe(0.42);
  });

  it('rejects clearly conflicting positive and negative evidence', () => {
    const assembled = assembleContext([
      result({ id: 'yes', content: 'Yes, the clinic accepts Cigna insurance.', confidenceScore: 0.9 }),
      result({ id: 'no', content: 'No, the clinic does not accept Cigna insurance.', confidenceScore: 0.9 }),
    ], 2000, 0.7);

    expect(assembled.hasConflictingContext).toBe(true);
    expect(assembled.hasSufficientContext).toBe(true);
  });
});
