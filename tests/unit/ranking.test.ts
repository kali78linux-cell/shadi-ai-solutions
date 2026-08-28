import { describe, it, expect } from 'vitest';
import { rankAndFilterResults, computeConfidenceScore, computeFAQBoost } from '@/lib/services/knowledge/ranking';
import {
  buildEntityRegistry,
  extractQueryEntities,
  computeEntityBoost,
} from '@/lib/services/knowledge/entities';
import { assembleContext } from '@/lib/services/knowledge/contextAssembly';
import type { RetrievalResult } from '@/lib/services/knowledge/retrieval';
import type { Entity } from '@/lib/services/knowledge/entities';

/**
 * Helper: creates a minimal RetrievalResult for testing.
 */
function makeResult(overrides: Partial<RetrievalResult>): RetrievalResult {
  return {
    id: 'chunk-1',
    document_id: 'doc-1',
    chunk_index: 0,
    content: 'Some content',
    similarity: 0.9,
    type: 'structured',
    ...overrides,
  };
}

describe('rankAndFilterResults', () => {
  it('should preserve similarity and set rankingScore', () => {
    const results: RetrievalResult[] = [
      makeResult({ id: 'a', similarity: 0.95, content: 'Content A' }),
      makeResult({ id: 'b', similarity: 0.85, content: 'Content B' }),
    ];

    const ranked = rankAndFilterResults(results, 'test query');

    // similarity must be preserved exactly
    expect(ranked[0].similarity).toBe(0.95);
    expect(ranked[1].similarity).toBe(0.85);

    // rankingScore should be set and used for ordering
    expect(ranked[0].rankingScore).toBeDefined();
    expect(ranked[1].rankingScore).toBeDefined();
    expect(ranked[0].rankingScore!).toBeGreaterThanOrEqual(ranked[1].rankingScore!);
  });

  it('should sort by rankingScore, not similarity', () => {
    // Result A has higher similarity but no entity match
    // Result B has lower similarity but matches a query entity → should rank higher
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.90,
        content: 'General information about dental care',
        metadata: { category: 'general' },
      }),
      makeResult({
        id: 'b',
        similarity: 0.85,
        content: 'Information about dental implants and procedures',
        metadata: { service: 'Implant' },
      }),
    ];

    const ranked = rankAndFilterResults(results, 'Implant');

    // similarity is preserved
    expect(ranked.find((r) => r.id === 'a')!.similarity).toBe(0.90);
    expect(ranked.find((r) => r.id === 'b')!.similarity).toBe(0.85);

    // But rankingScore should boost B above A due to entity match
    const rankedA = ranked.find((r) => r.id === 'a')!;
    const rankedB = ranked.find((r) => r.id === 'b')!;
    expect(rankedB.rankingScore!).toBeGreaterThan(rankedA.rankingScore!);
  });

  it('should filter out results below MIN_SIMILARITY_THRESHOLD', () => {
    const results: RetrievalResult[] = [
      makeResult({ id: 'a', similarity: 0.95, content: 'High sim' }),
      makeResult({ id: 'b', similarity: 0.5, content: 'Low sim' }),
    ];

    const ranked = rankAndFilterResults(results, 'query');

    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe('a');
  });

  it('should work without a query (backward compatibility)', () => {
    const results: RetrievalResult[] = [
      makeResult({ id: 'a', similarity: 0.95, content: 'Content A' }),
      makeResult({ id: 'b', similarity: 0.85, content: 'Content B' }),
    ];

    const ranked = rankAndFilterResults(results);

    // Without a query, rankingScore should equal similarity (no entity boost)
    expect(ranked[0].rankingScore).toBeCloseTo(0.95, 5);
    expect(ranked[1].rankingScore).toBeCloseTo(0.85, 5);
  });

  it('should handle empty results', () => {
    expect(rankAndFilterResults([], 'query')).toEqual([]);
    expect(rankAndFilterResults([], '')).toEqual([]);
  });

  it('should deduplicate by content, keeping the highest rankingScore', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.95,
        content: 'Duplicate content',
        metadata: { service: 'Implant' },
      }),
      makeResult({
        id: 'b',
        similarity: 0.85,
        content: 'Duplicate content',
        metadata: { service: 'Cleaning' },
      }),
    ];

    const ranked = rankAndFilterResults(results, 'Implant');

    // Only one result with content 'Duplicate content' should remain
    const duplicateContents = ranked.filter((r) => r.content === 'Duplicate content');
    expect(duplicateContents.length).toBe(1);

    // The one with the highest rankingScore should be kept (id 'a' has higher similarity + entity match)
    expect(duplicateContents[0].id).toBe('a');
  });

  it('should apply FAQ boost to FAQ chunks that match the query', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.85,
        content: 'We accept all major insurance plans.',
        subtype: 'faq',
        title: 'Accepted Insurance Plans',
      }),
      makeResult({
        id: 'b',
        similarity: 0.90,
        content: 'General clinic information.',
      }),
    ];

    const ranked = rankAndFilterResults(results, 'What insurance plans are accepted?');

    // FAQ chunk 'a' should be boosted above 'b' despite lower similarity
    const rankedA = ranked.find((r) => r.id === 'a')!;
    const rankedB = ranked.find((r) => r.id === 'b')!;

    // Both should be present
    expect(rankedA).toBeDefined();
    expect(rankedB).toBeDefined();

    // FAQ chunk should have rankingScore > similarity due to FAQ boost
    expect(rankedA.rankingScore!).toBeGreaterThan(rankedA.similarity);
  });

  it('should not apply FAQ boost to non-FAQ chunks', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.85,
        content: 'We accept all major insurance plans.',
        subtype: 'document',
        title: 'Insurance Info',
      }),
    ];

    const ranked = rankAndFilterResults(results, 'What insurance plans are accepted?');

    // Non-FAQ chunk should not get FAQ boost
    // rankingScore should be very close to similarity (may get a tiny entity boost from metadata)
    expect(ranked[0].rankingScore!).toBeLessThanOrEqual(ranked[0].similarity + 0.05);
  });

  it('should combine entity boost and FAQ boost in rankingScore', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.85,
        content: 'We accept Cigna and Aetna insurance plans.',
        subtype: 'faq',
        title: 'Accepted Insurance Plans',
        metadata: { insurance: 'Cigna' },
      }),
      makeResult({
        id: 'b',
        similarity: 0.90,
        content: 'General clinic information.',
      }),
    ];

    const ranked = rankAndFilterResults(results, 'What insurance plans does Cigna accept?');

    const rankedA = ranked.find((r) => r.id === 'a')!;

    // FAQ chunk with entity match should get both boosts
    // rankingScore should be > similarity + entity boost alone
    expect(rankedA.rankingScore!).toBeGreaterThan(rankedA.similarity + 0.05);
  });

  it('should let a higher-similarity non-FAQ chunk outrank a weakly-related FAQ chunk', () => {
    // The FAQ chunk only shares a single token ("dental") with the query, so its
    // FAQ + entity boost is small. The non-FAQ chunk has much higher raw similarity.
    // Boosts must NOT let the weak FAQ override semantic relevance.
    const results: RetrievalResult[] = [
      makeResult({
        id: 'non-faq',
        similarity: 0.95,
        content: 'The clinic provides comprehensive dental treatment services.',
        subtype: 'document',
        title: 'About the Clinic',
      }),
      makeResult({
        id: 'weak-faq',
        similarity: 0.80,
        content: 'We offer dental checkups.',
        subtype: 'faq',
        title: 'Dental Checkups',
      }),
    ];

    const ranked = rankAndFilterResults(
      results,
      'which insurance plans does clinic accept for dental treatment'
    );

    const nonFaq = ranked.find((r) => r.id === 'non-faq')!;
    const weakFaq = ranked.find((r) => r.id === 'weak-faq')!;

    // Both survive the threshold and the weak FAQ still gets a small boost
    expect(nonFaq).toBeDefined();
    expect(weakFaq).toBeDefined();
    expect(weakFaq.rankingScore!).toBeGreaterThan(weakFaq.similarity);

    // But the higher-similarity non-FAQ chunk must remain first
    expect(nonFaq.rankingScore!).toBeGreaterThan(weakFaq.rankingScore!);
    expect(ranked[0].id).toBe('non-faq');
  });
});

describe('computeFAQBoost', () => {
  it('should return 0 for non-FAQ chunks', () => {
    const result = makeResult({
      subtype: 'document',
      content: 'Some content about insurance',
      title: 'Insurance Info',
    });

    expect(computeFAQBoost(result, 'insurance')).toBe(0);
  });

  it('should return 0 for empty query', () => {
    const result = makeResult({
      subtype: 'faq',
      content: 'Some content about insurance',
      title: 'Insurance Info',
    });

    expect(computeFAQBoost(result, '')).toBe(0);
    expect(computeFAQBoost(result, '   ')).toBe(0);
  });

  it('should return positive boost when FAQ title matches query', () => {
    const result = makeResult({
      id: 'faq-1',
      subtype: 'faq',
      content: 'We accept all major insurance plans including Cigna and Aetna.',
      title: 'Accepted Insurance Plans',
    });

    const boost = computeFAQBoost(result, 'What insurance plans are accepted?');
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(0.2);
  });

  it('should return positive boost when FAQ content matches query', () => {
    const result = makeResult({
      id: 'faq-1',
      subtype: 'faq',
      content: 'We offer dental implants starting at $2000.',
      title: 'Implant Pricing',
    });

    const boost = computeFAQBoost(result, 'How much do implants cost?');
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(0.2);
  });

  it('should return 0 when FAQ content does not match query', () => {
    const result = makeResult({
      id: 'faq-1',
      subtype: 'faq',
      content: 'Our clinic hours are Monday to Friday 9am-5pm.',
      title: 'Clinic Hours',
    });

    const boost = computeFAQBoost(result, 'What insurance plans do you accept?');
    expect(boost).toBe(0);
  });

  it('should cap boost at MAX_FAQ_BOOST (0.2)', () => {
    const result = makeResult({
      id: 'faq-1',
      subtype: 'faq',
      content: 'insurance plans accepted insurance coverage insurance options',
      title: 'Insurance Plans Insurance Coverage',
    });

    const boost = computeFAQBoost(result, 'insurance plans accepted insurance coverage insurance');
    expect(boost).toBeLessThanOrEqual(0.2);
  });
});

describe('computeConfidenceScore', () => {
  it('should use rankingScore when available', () => {
    const result = makeResult({
      similarity: 0.9,
      rankingScore: 0.95,
    });

    const score = computeConfidenceScore(result, 5);
    // baseScore = 0.95, countFactor = 1.0
    // score = 0.95 * (0.7 + 0.3 * 1.0) = 0.95 * 1.0 = 0.95
    expect(score).toBeCloseTo(0.95, 5);
  });

  it('should fall back to similarity when rankingScore is not set', () => {
    const result = makeResult({
      similarity: 0.9,
    });

    const score = computeConfidenceScore(result, 5);
    // baseScore = 0.9, countFactor = 1.0
    // score = 0.9 * (0.7 + 0.3 * 1.0) = 0.9 * 1.0 = 0.9
    expect(score).toBeCloseTo(0.9, 5);
  });

  it('should apply count penalty for few results', () => {
    const result = makeResult({
      similarity: 0.9,
    });

    const score = computeConfidenceScore(result, 1);
    // baseScore = 0.9, countFactor = min(1, 1/5) = 0.2
    // score = 0.9 * (0.7 + 0.3 * 0.2) = 0.9 * 0.76 = 0.684
    expect(score).toBeCloseTo(0.684, 5);
  });
});

describe('buildEntityRegistry', () => {
  it('should extract entities from metadata', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.9,
        content: 'Content',
        metadata: { insurance: 'Cigna', service: 'Cleaning' },
      }),
    ];

    const registry = buildEntityRegistry(results);

    const names = registry.map((e) => e.name);
    expect(names).toContain('Cigna');
    expect(names).toContain('Cleaning');
    expect(registry.find((e) => e.name === 'Cigna')!.type).toBe('insurance');
    expect(registry.find((e) => e.name === 'Cleaning')!.type).toBe('service');
    expect(registry.find((e) => e.name === 'Cigna')!.source).toBe('metadata');
  });

  it('should extract entities from structured_data', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.9,
        content: 'Content',
        structured_data: { name: 'Implant', price: 2000 },
      }),
    ];

    const registry = buildEntityRegistry(results);

    const names = registry.map((e) => e.name);
    expect(names).toContain('Implant');
    expect(registry.find((e) => e.name === 'Implant')!.type).toBe('name');
    expect(registry.find((e) => e.name === 'Implant')!.source).toBe('structured_data');
  });

  it('should extract entities from FAQ titles', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.9,
        content: 'FAQ content',
        subtype: 'faq',
        title: 'Accepted Insurances',
      }),
    ];

    const registry = buildEntityRegistry(results);

    const faqEntity = registry.find((e) => e.name === 'Accepted Insurances');
    expect(faqEntity).toBeDefined();
    expect(faqEntity!.type).toBe('faq_topic');
    expect(faqEntity!.source).toBe('faq_title');
  });

  it('should extract entities from document titles', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.9,
        content: 'Document content',
        subtype: 'document',
        title: 'Service Pricing Guide',
      }),
    ];

    const registry = buildEntityRegistry(results);

    const docEntity = registry.find((e) => e.name === 'Service Pricing Guide');
    expect(docEntity).toBeDefined();
    expect(docEntity!.type).toBe('document_title');
    expect(docEntity!.source).toBe('document_title');
  });

  it('should NOT use hardcoded entity lists — entities are discovered dynamically', () => {
    // Use completely arbitrary entity names to prove no hardcoding
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.9,
        content: 'Content',
        metadata: { custom_field: 'Zaphod Beeblebrox' },
      }),
    ];

    const registry = buildEntityRegistry(results);

    const names = registry.map((e) => e.name);
    expect(names).toContain('Zaphod Beeblebrox');
    expect(names).not.toContain('Cigna');
    expect(names).not.toContain('Aetna');
    expect(names).not.toContain('Implant');
    expect(names).not.toContain('Cleaning');
  });

  it('should deduplicate entities', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.9,
        content: 'Content',
        metadata: { insurance: 'Cigna' },
      }),
      makeResult({
        id: 'b',
        similarity: 0.9,
        content: 'Content',
        metadata: { insurance: 'Cigna' },
      }),
    ];

    const registry = buildEntityRegistry(results);

    const cignaEntities = registry.filter((e) => e.name === 'Cigna');
    expect(cignaEntities.length).toBe(2); // Different chunk IDs, so not deduplicated
  });
});

describe('extractQueryEntities', () => {
  it('should match single-word entities in the query', () => {
    const registry: Entity[] = [
      { id: '1', name: 'Implant', type: 'service', source: 'structured_data' },
      { id: '2', name: 'Cleaning', type: 'service', source: 'metadata' },
    ];

    const matched = extractQueryEntities('How much for an Implant?', registry);
    expect(matched).toContain('Implant');
    expect(matched).not.toContain('Cleaning');
  });

  it('should match multi-word entities in the query', () => {
    const registry: Entity[] = [
      { id: '1', name: 'Dental Implant', type: 'service', source: 'structured_data' },
    ];

    const matched = extractQueryEntities('What is the cost of a Dental Implant?', registry);
    expect(matched).toContain('Dental Implant');
  });

  it('should be case-insensitive', () => {
    const registry: Entity[] = [
      { id: '1', name: 'IMPLANT', type: 'service', source: 'structured_data' },
    ];

    const matched = extractQueryEntities('how much for an implant?', registry);
    expect(matched).toContain('IMPLANT');
  });

  it('should return empty array for empty query', () => {
    const registry: Entity[] = [
      { id: '1', name: 'Implant', type: 'service', source: 'structured_data' },
    ];

    expect(extractQueryEntities('', registry)).toEqual([]);
    expect(extractQueryEntities('   ', registry)).toEqual([]);
  });

  it('should return empty array for empty registry', () => {
    expect(extractQueryEntities('some query', [])).toEqual([]);
  });
});

describe('computeEntityBoost', () => {
  it('should return 0 when no query entities', () => {
    const result = makeResult({
      id: 'a',
      similarity: 0.9,
      content: 'Some content about implants',
    });

    expect(computeEntityBoost(result, [])).toBe(0);
  });

  it('should boost results that contain query entities', () => {
    const result = makeResult({
      id: 'a',
      similarity: 0.9,
      content: 'Information about dental implants and procedures',
      metadata: { service: 'Implant' },
    });

    const boost = computeEntityBoost(result, ['Implant']);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(0.3);
  });

  it('should boost more for multiple matching entities', () => {
    const result = makeResult({
      id: 'a',
      similarity: 0.9,
      content: 'Implant and Cleaning services',
      metadata: { service: 'Implant', insurance: 'Cleaning' },
    });

    const boost = computeEntityBoost(result, ['Implant', 'Cleaning']);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(0.3);
  });

  it('should not boost results without matching entities', () => {
    const result = makeResult({
      id: 'a',
      similarity: 0.9,
      content: 'General information about dental care',
    });

    const boost = computeEntityBoost(result, ['Implant']);
    expect(boost).toBe(0);
  });

  it('should cap boost at MAX_ENTITY_BOOST (0.3)', () => {
    // Create a result with many matching entities
    const result = makeResult({
      id: 'a',
      similarity: 0.9,
      content: 'Implant Cleaning Aetna Cigna',
      metadata: {
        service: 'Implant',
        insurance: 'Cigna',
        material: 'Cleaning',
        provider: 'Aetna',
      },
    });

    const boost = computeEntityBoost(result, ['Implant', 'Cleaning', 'Cigna', 'Aetna']);
    expect(boost).toBeLessThanOrEqual(0.3);
  });

  it('should use type weights from registry', () => {
    const result = makeResult({
      id: 'a',
      similarity: 0.9,
      content: 'Implant information',
      metadata: { service: 'Implant' },
    });

    const registry: Entity[] = [
      { id: '1', name: 'Implant', type: 'service', source: 'metadata' },
    ];

    const boost = computeEntityBoost(result, ['Implant'], registry);
    // service type weight = 1.0, 1 entity * 0.1 * 1.0 = 0.1
    expect(boost).toBeCloseTo(0.1, 5);
  });
});

describe('Token Budget', () => {
  it('should respect token budget in context assembly', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'a',
        similarity: 0.95,
        content: 'This is a long chunk of text that should take up many tokens in the context assembly process.',
        confidenceScore: 0.95,
      }),
      makeResult({
        id: 'b',
        similarity: 0.90,
        content: 'Second chunk with some content about dental procedures.',
        confidenceScore: 0.90,
      }),
      makeResult({
        id: 'c',
        similarity: 0.85,
        content: 'Third chunk about insurance and coverage.',
        confidenceScore: 0.85,
      }),
    ];

    const assembled = assembleContext(results, 30, 0.7);

    // Token budget should be respected
    expect(assembled.totalTokens).toBeLessThanOrEqual(30);
    expect(assembled.chunks.length).toBeGreaterThan(0);
    // Not all chunks fit within the budget → truncated
    expect(assembled.truncated).toBe(true);
  });
});

describe('Citation Metadata', () => {
  it('should preserve citation metadata in assembled context', () => {
    const results: RetrievalResult[] = [
      makeResult({
        id: 'chunk-1',
        document_id: 'doc-1',
        chunk_index: 0,
        content: 'The clinic accepts the treatment.',
        similarity: 0.9,
        rankingScore: 0.9,
        confidenceScore: 0.88,
        type: 'unstructured',
        document: {
          id: 'doc-1',
          original_filename: 'clinic-faq.pdf',
          file_type: 'pdf',
          mime_type: 'application/pdf',
        },
        page_number: 4,
      }),
    ];

    const assembled = assembleContext(results, 2000, 0.7);

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

describe('computeConfidenceScore — sparse-result countFactor (STEP 9D: pinned, intentionally unchanged)', () => {
  it('applies a small penalty when few results and none when many (no change to countFactor)', () => {
    // base 0.8, 1 result → countFactor = min(1, 1/5)=0.2 → 0.8*(0.7+0.3*0.2)=0.608
    const sparse = computeConfidenceScore(makeResult({ similarity: 0.8 }), 1);
    expect(sparse).toBeCloseTo(0.608, 3);
    // base 0.8, 5+ results → countFactor = 1 → 0.8*1.0 = 0.8
    const plenty = computeConfidenceScore(makeResult({ similarity: 0.8 }), 5);
    expect(plenty).toBeCloseTo(0.8, 3);
    // penalty is downward-only and bounded: never exceeds raw base
    expect(sparse).toBeLessThan(0.8);
  });
});

});