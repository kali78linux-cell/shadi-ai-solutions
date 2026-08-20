# Retrieval & Ranking Design — Updated

## Status: IMPLEMENTED

## 1. Problem Statement

The current retrieval pipeline has two issues:

### 1.1 Similarity Score Overwritten

The original vector similarity score (embedding distance) is overwritten at multiple points:

1. **`contextRetrieval.ts` (line 74–77):** `hybridScore` is mapped back onto `similarity`:
   ```ts
   const mappedResults = results.map((r) => ({
     ...r,
     similarity: r.hybridScore,  // ← OVERWRITES original vector similarity
   }));
   ```

2. **`retrieval.ts` `keywordSearchClinic` (line 230):** keyword relevance score overwrites `similarity`:
   ```ts
   return { ...chunk, similarity: keywordScore };  // ← OVERWRITES original similarity
   ```

3. **`ranking.ts` `rankAndFilterResults` (line 32–34):** sorts by `similarity`, which is now the hybrid/keyword score, not the raw embedding distance.

4. **`contextAssembly.ts` `assembleContext` (line 81–89):** sorts by `confidence`, which is derived from `similarity` via `computeConfidenceScore`.

**Impact:** The `result.similarity` field no longer represents the raw embedding distance. It is a composite of hybrid/keyword scores, making it impossible to reason about the true semantic distance between the query and the document.

### 1.2 No Entity Boosting

There is no entity extraction or boosting logic. The system relies solely on vector similarity and keyword matching. There is no mechanism to boost results that contain entities (e.g., insurance providers, services, materials) mentioned in the user's query.

## 2. Design Goals

1. **Preserve `result.similarity`** — Keep it exactly as returned by vector search. It represents the embedding distance and must never be overwritten.
2. **Introduce a separate `rankingScore`** — A composite score used for ordering that combines similarity, keyword relevance, and entity boosting.
3. **Dynamic entity boosting** — Extract entities dynamically from:
   - User query
   - Document metadata
   - Structured knowledge (`structured_data` field)
   - FAQ titles
   - **No hardcoded production-specific lists** (no Cigna, Aetna, Implant, Cleaning, etc.)
4. **Backward compatibility** — Existing callers and tests that reference `similarity` should continue to work. The `rankingScore` is an additive field.

## 3. Updated Architecture

### 3.1 Data Flow

```
User Query
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 1. hybridSearchClinic()                                   │
│    - vectorSearchClinic() → similarity (RAW, preserved)  │
│    - keywordSearchClinic() → keywordScore (separate)     │
│    - hybridScore = vectorWeight * similarity             │
│                + keywordWeight * keywordScore            │
│    - Returns HybridSearchResult[]                        │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 2. buildEntityRegistry()  [NEW]                          │
│    - Scans retrieval results for entities from:          │
│      • document metadata                                 │
│      • structured_data fields                            │
│      • FAQ titles (title field)                          │
│      • document titles                                   │
│    - Returns Entity[] (dynamic, no hardcoded lists)      │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 3. extractQueryEntities()  [NEW]                          │
│    - Tokenizes the user query                            │
│    - Matches tokens/n-grams against the entity registry  │
│    - Returns matched entity names                        │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 4. rankAndFilterResults()  [UPDATED]                     │
│    - Filters by MIN_SIMILARITY_THRESHOLD (on similarity) │
│    - Computes rankingScore for each result:              │
│      rankingScore = hybridScore                          │
│                   + entityBoost                          │
│    - entityBoost = f(matching entities, entity type)     │
│    - Sorts by rankingScore DESC                          │
│    - similarity remains UNTOUCHED                        │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 5. assembleContext()  [UPDATED]                           │
│    - Sorts by rankingScore (falls back to confidence)    │
│    - confidenceScore in citations derived from           │
│      rankingScore (not raw similarity)                   │
│    - similarity in RetrievalResult remains UNTOUCHED     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Type Changes

#### `RetrievalResult` (retrieval.ts)

```ts
export interface RetrievalResult {
  id: string;
  document_id: string | null;
  chunk_index: number | null;
  content: string | null;
  /** Raw vector similarity from the embedding search. NEVER overwritten. */
  similarity: number;
  /** Composite ranking score used for ordering. Combines similarity,
   *  keyword relevance, and entity boosting. */
  rankingScore?: number;
  type: 'structured' | 'unstructured';
  subtype?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  language?: string | null;
  created_at?: string;
  updated_at?: string;
  document?: { id: string; original_filename: string; file_type: string; mime_type: string } | null;
}
```

#### `HybridSearchResult` (retrieval.ts)

```ts
export interface HybridSearchResult extends RetrievalResult {
  vectorScore: number;   // = similarity (raw, preserved)
  keywordScore: number;  // separate from similarity
  hybridScore: number;   // weighted combination
}
```

### 3.3 New Module: `lib/services/knowledge/entities.ts`

#### Entity Interface

```ts
export interface Entity {
  /** Unique identifier for the entity. */
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
```

#### Functions

1. **`buildEntityRegistry(results: RetrievalResult[]): Entity[]`**
   - Scans each result's `metadata`, `structured_data`, `title`, and `content` fields.
   - Extracts entity-like values from known field patterns:
     - `metadata`: any key-value pair where the value is a string (e.g., `{ insurance: "Cigna" }`)
     - `structured_data`: JSON objects with `name`, `title`, `service`, `insurance`, `provider`, `material` fields
     - `title`: used as an entity of type `faq_title` or `document_title`
   - **No hardcoded entity names** — entities are discovered dynamically from the data.
   - Returns a deduplicated list of entities.

2. **`extractQueryEntities(query: string, registry: Entity[]): string[]`**
   - Tokenizes the query into words and n-grams (1-grams, 2-grams, 3-grams).
   - Matches tokens against entity names in the registry (case-insensitive).
   - Returns the list of matched entity names.

3. **`computeEntityBoost(result: RetrievalResult, queryEntities: string[]): number`**
   - Checks if the result's content, title, metadata, or structured_data contains any of the query entities.
   - Returns a boost score in range [0, 0.3] (capped to avoid overwhelming the base score).
   - Boost is proportional to the number of matching entities and their type weight.

### 3.4 Updated Module: `lib/services/knowledge/ranking.ts`

#### `rankAndFilterResults`

```ts
export function rankAndFilterResults(
  results: RetrievalResult[],
  query: string = '',
  entityRegistry?: Entity[]
): RetrievalResult[] {
  // 1. Filter by MIN_SIMILARITY_THRESHOLD (on raw similarity — preserved)
  const highConfidence = results.filter(r => r.similarity >= MIN_SIMILARITY_THRESHOLD);

  // 2. Build entity registry if not provided
  const registry = entityRegistry ?? buildEntityRegistry(highConfidence);

  // 3. Extract query entities
  const queryEntities = query ? extractQueryEntities(query, registry) : [];

  // 4. Compute rankingScore for each result
  const scored = highConfidence.map(result => {
    const entityBoost = computeEntityBoost(result, queryEntities);
    const rankingScore = (result.rankingScore ?? result.similarity) + entityBoost;
    return { ...result, rankingScore };
  });

  // 5. Sort by rankingScore DESC (NOT similarity)
  return scored.sort((a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0));
}
```

#### `computeConfidenceScore`

```ts
export function computeConfidenceScore(result: RetrievalResult, totalResults: number): number {
  // Use rankingScore if available, fall back to similarity
  const baseScore = result.rankingScore ?? result.similarity ?? 0;
  const countFactor = Math.min(1, totalResults / 5);
  return Math.min(1, baseScore * (0.7 + 0.3 * countFactor));
}
```

### 3.5 Updated Module: `lib/ai/contextRetrieval.ts`

#### Key Changes

1. **Stop mapping `hybridScore` to `similarity`:**
   ```ts
   // BEFORE (overwrites similarity):
   const mappedResults = results.map((r) => ({ ...r, similarity: r.hybridScore }));

   // AFTER (preserves similarity, sets rankingScore):
   const mappedResults = results.map((r) => ({
     ...r,
     similarity: r.similarity,        // ← PRESERVED (raw vector distance)
     rankingScore: r.hybridScore,     // ← NEW: used for ordering
   }));
   ```

2. **Pass the user query to `rankAndFilterResults`:**
   ```ts
   const rankedResults = rankAndFilterResults(uniqueResults, text);
   ```

3. **`assembleContext` already sorts by `confidence`** (derived from `computeConfidenceScore`), which will now use `rankingScore` as the base. No change needed in `assembleContext` itself — it delegates to `computeConfidenceScore`.

### 3.6 Updated Module: `lib/services/knowledge/retrieval.ts`

#### `keywordSearchClinic`

```ts
// BEFORE:
return { ...chunk, similarity: keywordScore };

// AFTER:
return { ...chunk, keywordScore };  // keywordScore is separate, similarity preserved
```

Note: `keywordSearchClinic` returns `RetrievalResult[]`, so we need to add `keywordScore` as an optional field or use a different return type. Since `HybridSearchResult` already has `keywordScore`, we can keep `keywordSearchClinic` returning `RetrievalResult[]` with an optional `keywordScore` field, or change it to return `HybridSearchResult[]`.

**Decision:** Add `keywordScore?: number` to `RetrievalResult` as an optional field. This keeps backward compatibility while allowing the keyword score to be carried alongside the preserved `similarity`.

## 4. Entity Extraction Strategy (Dynamic, No Hardcoded Lists)

### 4.1 What Constitutes an Entity?

An entity is any named value found in the knowledge base that represents a real-world concept relevant to the clinic. The system discovers these dynamically:

| Source | Extraction Method |
|--------|------------------|
| **Document metadata** | Scan `metadata` object for string values. Each key-value pair where the value is a non-empty string becomes an entity. The key determines the type (e.g., `metadata.insurance` → type `insurance`). |
| **Structured knowledge** | Scan `structured_data` JSON for fields named `name`, `title`, `service`, `insurance`, `provider`, `material`, `condition`, `procedure`, etc. The value becomes the entity name. |
| **FAQ titles** | The `title` field of FAQ-type chunks (where `subtype === 'faq'`) becomes an entity of type `faq_topic`. |
| **Document titles** | The `title` field of document-type chunks becomes an entity of type `document_title`. |

### 4.2 Query Entity Matching

The user query is tokenized and matched against the entity registry:

1. **Tokenization:** Split query into lowercase words.
2. **N-gram generation:** Generate 1-grams, 2-grams, and 3-grams from the tokenized query.
3. **Matching:** For each entity in the registry, check if the entity name (or any n-gram of it) appears in the query n-grams.
4. **Result:** Return the list of matched entity names.

This approach is fully dynamic — entities are discovered from the knowledge base content, not from a hardcoded list.

### 4.3 Entity Boosting Formula

```
entityBoost = min(0.3, matchedEntityCount * 0.1 * typeWeight)
```

Where `typeWeight` is a multiplier based on entity type:
- `insurance`: 1.0 (high relevance for patient inquiries)
- `service`: 1.0
- `material`: 0.8
- `faq_topic`: 0.7
- `document_title`: 0.5
- `metadata` (generic): 0.6

The boost is capped at 0.3 to ensure it enhances but doesn't override the base similarity score.

## 5. Backward Compatibility

- `result.similarity` remains a required field on `RetrievalResult` — unchanged.
- `rankingScore` is an optional field — existing code that doesn't use it continues to work.
- `keywordScore` is an optional field on `RetrievalResult` — existing code that doesn't use it continues to work.
- `rankAndFilterResults` accepts an optional `query` parameter — existing callers that don't pass it get the old behavior (sort by similarity).
- `computeConfidenceScore` falls back to `similarity` when `rankingScore` is not set.
- Tests that check `similarity` values remain valid.

## 6. Files to Modify

| File | Change |
|------|--------|
| `lib/services/knowledge/retrieval.ts` | Add `rankingScore?` and `keywordScore?` to `RetrievalResult`. Fix `keywordSearchClinic` to not overwrite `similarity`. |
| `lib/services/knowledge/entities.ts` | **NEW** — Entity extraction and boosting module. |

## 7. Production RAG Reliability

The production path now carries one typed evidence record from retrieval through
ranking, context assembly, prompt construction, and orchestration:

```text
User message -> language-aware hybrid retrieval -> ranking -> quality gate
             -> token-bounded context -> prompt with citations -> LLM response
```

Each assembled citation preserves `filename`, `documentId`, `chunkId`,
`chunkIndex`, optional `pageNumber`, source content, and a confidence score.
Document metadata is looked up by document ID within the tenant-scoped
retrieval path; the database schema is unchanged.

The confidence score is derived from the ranked score and result-count factor,
then retained on `RetrievalResult` and `SourceCitation`. The orchestrator uses a
configurable threshold and refuses to call the model for low-confidence or
conflicting `AssembledContext` evidence. It returns a localized unavailable
response instead. Legacy array-returning retrieval callers keep their existing
behavior and signatures.

Context assembly removes duplicate normalized content, retains the highest
scoring copy, preserves source metadata, and stops at the configured token
budget. A conservative conflict check only flags opposing positive/negative
statements with shared terms; ambiguous prose is left for normal ranking.

Remaining roadmap: evaluate confidence calibration against production traces,
add provider-level citation verification, and expose the typed citations and
confidence fields through the frontend response contract.
| `lib/services/knowledge/ranking.ts` | Update `rankAndFilterResults` to accept query + entity registry, compute `rankingScore`, sort by it. Update `computeConfidenceScore` to use `rankingScore`. |
| `lib/ai/contextRetrieval.ts` | Stop mapping `hybridScore` to `similarity`. Set `rankingScore` instead. Pass query to `rankAndFilterResults`. |
| `lib/services/knowledge/contextAssembly.ts` | Update `assembleContext` to sort by `rankingScore` (via `computeConfidenceScore`). |
| `tests/unit/retrieval.test.ts` | Update tests to verify `similarity` is preserved and `rankingScore` is used for ordering. |
| `tests/unit/ranking.test.ts` | **NEW** — Tests for entity boosting and ranking score computation. |

## 7. Test Plan

1. **Similarity preservation test:** Verify that `result.similarity` equals the raw vector similarity after the full pipeline.
2. **Ranking score test:** Verify that `rankingScore` is computed and used for ordering.
3. **Entity boosting test:** Verify that results containing query entities are boosted.
4. **No hardcoded entities test:** Verify that entity extraction works with arbitrary clinic data (not just Cigna/Aetna/Implant/Cleaning).
5. **Backward compatibility test:** Verify existing tests still pass.
