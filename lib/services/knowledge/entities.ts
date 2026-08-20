/**
 * Dynamic entity extraction and boosting for retrieval ranking.
 *
 * Entities are discovered dynamically from the knowledge base content —
 * document metadata, structured_data fields, FAQ titles, and document titles.
 * No hardcoded production-specific lists (e.g. no "Cigna", "Aetna", "Implant",
 * "Cleaning") are used. Every entity is extracted from the actual data at
 * runtime.
 */

import type { RetrievalResult } from './retrieval';

/**
 * A single entity discovered in the knowledge base.
 */
export interface Entity {
  /** Unique identifier for the entity (name + type + source). */
  id: string;
  /** The entity name as it appears in the knowledge base. */
  name: string;
  /** Entity type (e.g. 'insurance', 'service', 'material', 'faq_topic'). */
  type: string;
  /** Where the entity was extracted from. */
  source: 'metadata' | 'structured_data' | 'faq_title' | 'document_title';
  /** The chunk ID this entity was found in. */
  chunkId?: string;
  /** The document ID this entity belongs to. */
  documentId?: string;
}

/**
 * Field names in `structured_data` or `metadata` that are treated as entity
 * sources. The *key* determines the entity type. These are generic field-name
 * patterns, not entity values — no production-specific names are hardcoded.
 */
const ENTITY_FIELD_NAMES = [
  'name',
  'title',
  'service',
  'insurance',
  'provider',
  'material',
  'condition',
  'procedure',
  'brand',
  'manufacturer',
  'plan',
  'network',
  'specialty',
  'treatment',
  'product',
  'category',
  'topic',
  'subject',
];

/**
 * Type weights used when computing the entity boost.
 * Higher weights mean the entity type is more relevant to ranking.
 */
const ENTITY_TYPE_WEIGHTS: Record<string, number> = {
  insurance: 1.0,
  service: 1.0,
  material: 0.8,
  faq_topic: 0.7,
  document_title: 0.5,
  provider: 0.9,
  procedure: 0.9,
  condition: 0.8,
  treatment: 0.9,
  product: 0.7,
  brand: 0.7,
  manufacturer: 0.6,
  plan: 0.8,
  network: 0.7,
  specialty: 0.7,
  category: 0.5,
  topic: 0.6,
  subject: 0.5,
};

/** Default weight for entity types not in the map above. */
const DEFAULT_TYPE_WEIGHT = 0.6;

/** Maximum boost a single result can receive from entity matching. */
const MAX_ENTITY_BOOST = 0.3;

/** Boost per matched entity (before type weight). */
const BOOST_PER_ENTITY = 0.1;

/**
 * Question words used to detect whether a user query is a question.
 * Includes English and Arabic question markers.
 */
const QUESTION_WORDS = [
  'what', 'how', 'do', 'does', 'is', 'are', 'can', 'when', 'where',
  'which', 'who', 'why', 'will', 'would', 'should', 'could',
  'هل', 'كيف', 'ما', 'متى', 'أين', 'من', 'لماذا', 'هل',
];

/** Maximum boost a FAQ chunk can receive when directly related to the query. */
const MAX_FAQ_BOOST = 0.15;

/** Minimum term-overlap ratio for a FAQ to be considered directly related. */
const FAQ_MIN_OVERLAP = 0.3;

/**
 * Builds an entity registry by scanning retrieval results for entity-like
 * values in metadata, structured_data, FAQ titles, and document titles.
 *
 * This function is fully dynamic — it discovers entities from the actual
 * knowledge base content. No hardcoded entity names are used.
 *
 * @param results The retrieval results to scan.
 * @returns A deduplicated list of entities.
 */
export function buildEntityRegistry(results: RetrievalResult[]): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    // 1. Extract from metadata
    if (result.metadata && typeof result.metadata === 'object') {
      for (const [key, value] of Object.entries(result.metadata)) {
        if (typeof value === 'string' && value.trim().length > 0) {
          const type = ENTITY_FIELD_NAMES.includes(key.toLowerCase())
            ? key.toLowerCase()
            : 'metadata';
          addEntity(entities, seen, {
            id: `${value.toLowerCase()}:${type}:${result.id}`,
            name: value.trim(),
            type,
            source: 'metadata',
            chunkId: result.id,
            documentId: result.document_id ?? undefined,
          });
        }
      }
    }

    // 2. Extract from structured_data
    if (result.structured_data && typeof result.structured_data === 'object') {
      for (const [key, value] of Object.entries(result.structured_data)) {
        if (typeof value === 'string' && value.trim().length > 0) {
          const type = ENTITY_FIELD_NAMES.includes(key.toLowerCase())
            ? key.toLowerCase()
            : 'metadata';
          addEntity(entities, seen, {
            id: `${value.toLowerCase()}:${type}:${result.id}`,
            name: value.trim(),
            type,
            source: 'structured_data',
            chunkId: result.id,
            documentId: result.document_id ?? undefined,
          });
        }
      }
    }

    // 3. Extract from FAQ titles (subtype === 'faq')
    if (result.subtype === 'faq' && result.title && result.title.trim().length > 0) {
      addEntity(entities, seen, {
        id: `${result.title.toLowerCase()}:faq_topic:${result.id}`,
        name: result.title.trim(),
        type: 'faq_topic',
        source: 'faq_title',
        chunkId: result.id,
        documentId: result.document_id ?? undefined,
      });
    }

    // 4. Extract from document titles (subtype === 'document' or type === 'unstructured')
    if (
      result.title &&
      result.title.trim().length > 0 &&
      result.subtype !== 'faq'
    ) {
      addEntity(entities, seen, {
        id: `${result.title.toLowerCase()}:document_title:${result.id}`,
        name: result.title.trim(),
        type: 'document_title',
        source: 'document_title',
        chunkId: result.id,
        documentId: result.document_id ?? undefined,
      });
    }
  }

  return entities;
}

/**
 * Extracts entities from the user query by matching query tokens against
 * the entity registry.
 *
 * Uses n-gram matching (1-grams, 2-grams, 3-grams) to handle multi-word
 * entity names. Matching is case-insensitive.
 *
 * @param query The user's query text.
 * @param registry The entity registry to match against.
 * @returns A list of matched entity names.
 */
export function extractQueryEntities(query: string, registry: Entity[]): string[] {
  if (!query || !query.trim() || registry.length === 0) {
    return [];
  }

  const queryLower = query.toLowerCase().trim();
  const queryTokens = queryLower
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (queryTokens.length === 0) {
    return [];
  }

  // Generate n-grams from the query (1-grams, 2-grams, 3-grams)
  const ngrams = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i <= queryTokens.length - n; i++) {
      ngrams.add(queryTokens.slice(i, i + n).join(' '));
    }
  }

  const matchedEntities: string[] = [];
  const seen = new Set<string>();

  for (const entity of registry) {
    const entityNameLower = entity.name.toLowerCase().trim();
    if (!entityNameLower || seen.has(entityNameLower)) {
      continue;
    }

    // Check if the entity name (or any n-gram of it) appears in the query n-grams
    const entityTokens = entityNameLower
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (entityTokens.length === 0) {
      continue;
    }

    // For multi-word entities, check if all tokens appear consecutively in the query
    // For single-word entities, check if the token appears in the query
    let matched = false;

    if (entityTokens.length === 1) {
      // Single-word entity: check if the token is in the query n-grams
      matched = ngrams.has(entityTokens[0]);
    } else {
      // Multi-word entity: check if the full entity name is a query n-gram
      // Also check if any sub-ngram of the entity matches
      for (let n = 1; n <= Math.min(entityTokens.length, 3); n++) {
        for (let i = 0; i <= entityTokens.length - n; i++) {
          const subNgram = entityTokens.slice(i, i + n).join(' ');
          if (ngrams.has(subNgram)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }

    if (matched) {
      seen.add(entityNameLower);
      matchedEntities.push(entity.name);
    }
  }

  return matchedEntities;
}

/**
 * Computes an entity boost score for a retrieval result based on how many
 * query entities it contains.
 *
 * The boost is computed by checking if the result's content, title, metadata,
 * or structured_data contains any of the query entities. The boost is
 * proportional to the number of matching entities and their type weight,
 * capped at MAX_ENTITY_BOOST.
 *
 * @param result The retrieval result to score.
 * @param queryEntities The list of entity names extracted from the query.
 * @param registry The entity registry (used to look up entity types).
 * @returns A boost score in range [0, MAX_ENTITY_BOOST].
 */
export function computeEntityBoost(
  result: RetrievalResult,
  queryEntities: string[],
  registry?: Entity[]
): number {
  if (!queryEntities || queryEntities.length === 0) {
    return 0;
  }

  // Build a lookup from entity name to type weight
  const entityTypeMap = new Map<string, number>();
  if (registry) {
    for (const entity of registry) {
      const weight = ENTITY_TYPE_WEIGHTS[entity.type] ?? DEFAULT_TYPE_WEIGHT;
      // Keep the highest weight for each entity name
      const existing = entityTypeMap.get(entity.name.toLowerCase());
      if (existing === undefined || weight > existing) {
        entityTypeMap.set(entity.name.toLowerCase(), weight);
      }
    }
  }

  // Gather all text fields from the result to search for entity matches
  const searchTextParts: string[] = [];
  if (result.content) searchTextParts.push(result.content);
  if (result.title) searchTextParts.push(result.title);
  if (result.metadata) {
    for (const value of Object.values(result.metadata)) {
      if (typeof value === 'string') searchTextParts.push(value);
    }
  }
  if (result.structured_data) {
    for (const value of Object.values(result.structured_data)) {
      if (typeof value === 'string') searchTextParts.push(value);
    }
  }

  const searchText = searchTextParts.join(' ').toLowerCase();

  let matchedCount = 0;
  let totalWeight = 0;

  for (const entityName of queryEntities) {
    const entityLower = entityName.toLowerCase().trim();
    if (entityLower && searchText.includes(entityLower)) {
      matchedCount++;
      const weight = entityTypeMap.get(entityLower) ?? DEFAULT_TYPE_WEIGHT;
      totalWeight += weight;
    }
  }

  if (matchedCount === 0) {
    return 0;
  }

  // Boost = matchedCount * BOOST_PER_ENTITY * averageTypeWeight
  const avgWeight = totalWeight / matchedCount;
  const boost = matchedCount * BOOST_PER_ENTITY * avgWeight;

  return Math.min(MAX_ENTITY_BOOST, boost);
}

/**
 * Helper: adds an entity to the list if it hasn't been seen before.
 */
function addEntity(
  entities: Entity[],
  seen: Set<string>,
  entity: Entity
): void {
  if (!seen.has(entity.id)) {
    seen.add(entity.id);
    entities.push(entity);
  }
}
