import { RetrievalResult } from './retrieval';
import { computeConfidenceScore } from './ranking';

/**
 * A source citation that can be returned to the caller for display in a UI.
 */
export interface SourceCitation {
  documentId: string | null;
  filename: string;
  chunkId: string;
  chunkIndex: number | null;
  pageNumber?: number | null;
  confidenceScore: number;
  content: string;
}

/**
 * A single assembled context chunk with its citation metadata.
 */
export interface ContextChunk {
  content: string;
  citation: SourceCitation;
  /** Original ranked result, retained so downstream prompt builders cannot lose content. */
  result?: RetrievalResult;
}

/**
 * The result of context assembly.
 */
export interface AssembledContext {
  chunks: ContextChunk[];
  citations: SourceCitation[];
  totalTokens: number;
  truncated: boolean;
  /** True when the assembled evidence passes the configured quality threshold. */
  hasSufficientContext: boolean;
  /** Whether retrieved evidence contains an unresolved source conflict. */
  hasConflictingContext: boolean;
}

/**
 * Approximate tokens per word for context length estimation.
 * Using 0.75 words/token as a rough heuristic (English average).
 */
const TOKENS_PER_WORD = 0.75;
const WORDS_PER_TOKEN = 1 / TOKENS_PER_WORD;

/**
 * Estimates the number of tokens in a text string.
 * Uses a simple word-count heuristic for speed.
 */
export function estimateTokenCount(text: string): number {
  if (!text || !text.trim()) return 0;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.ceil(wordCount * WORDS_PER_TOKEN);
}

/**
 * Assembles context from retrieval results.
 *
 * Pipeline:
 * 1. Rank and filter results by confidence.
 * 2. Remove duplicate chunks (by content hash).
 * 3. Preserve document hierarchy (group by document, sort by chunk_index).
 * 4. Prioritize newest and highest-scoring knowledge.
 * 5. Respect token limits.
 * 6. Generate source citations.
 *
 * @param results The raw retrieval results from vector search.
 * @param maxTokens The maximum number of tokens to include in the context.
 * @returns The assembled context with chunks, citations, and metadata.
 */
export function assembleContext(
  results: RetrievalResult[],
  maxTokens: number = 2000,
  confidenceThreshold: number = 0.7
): AssembledContext {
  if (!results || results.length === 0) {
    return {
      chunks: [],
      citations: [],
      totalTokens: 0,
      truncated: false,
      hasSufficientContext: false,
      hasConflictingContext: false,
    };
  }

  // 1. Compute confidence scores for all results
  const scoredResults = results.map((result) => ({
    result,
    confidence: result.confidenceScore ?? computeConfidenceScore(result, results.length),
  }));

  // 2. Sort by confidence score descending (derived from rankingScore), then by created_at descending (newest first)
  const sorted = scoredResults.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    // Tie-breaker: newest first
    const aTime = a.result.created_at || a.result.updated_at || '';
    const bTime = b.result.created_at || b.result.updated_at || '';
    return bTime.localeCompare(aTime);
  });


  // 3. Remove duplicates based on content (preserve first occurrence = highest score)
  const seenContent = new Set<string>();
  const uniqueResults: typeof sorted = [];
  for (const item of sorted) {
    const contentKey = item.result.content?.trim().toLowerCase() || '';
    if (contentKey && !seenContent.has(contentKey)) {
      seenContent.add(contentKey);
      uniqueResults.push(item);
    }
  }

  // 4. Group by document to preserve hierarchy
  const byDocument = new Map<string | null, typeof uniqueResults>();
  for (const item of uniqueResults) {
    const docId = item.result.document_id;
    if (!byDocument.has(docId)) {
      byDocument.set(docId, []);
    }
    byDocument.get(docId)!.push(item);
  }

  // 5. Within each document group, sort by chunk_index to preserve order
  const orderedResults: typeof uniqueResults = [];
  for (const entry of Array.from(byDocument.entries())) {
    const [, group] = entry;
    group.sort((a, b) => {
      const aIdx = a.result.chunk_index ?? 0;
      const bIdx = b.result.chunk_index ?? 0;
      return aIdx - bIdx;
    });
    orderedResults.push(...group);
  }

  // 6. Build context chunks with citations, respecting token limits
  const chunks: ContextChunk[] = [];
  const citations: SourceCitation[] = [];
  let totalTokens = 0;
  let truncated = false;

  for (const item of orderedResults) {
    const content = item.result.content || '';
    const contentTokens = estimateTokenCount(content);

    // Check if adding this chunk would exceed the token limit
    if (totalTokens + contentTokens > maxTokens) {
      // Try to fit a truncated version
      const remainingTokens = maxTokens - totalTokens;
      if (remainingTokens > 50) {
        // Include a partial chunk if there's enough room
        const words = content.split(/\s+/);
        const wordsToKeep = Math.floor(remainingTokens * WORDS_PER_TOKEN);
        const truncatedContent = words.slice(0, wordsToKeep).join(' ');
        if (truncatedContent) {
          const citation: SourceCitation = {
            documentId: item.result.document_id,
            filename: item.result.document?.original_filename || 'knowledge base',
            chunkId: item.result.id,
            chunkIndex: item.result.chunk_index,
            pageNumber: item.result.page_number ?? null,
            confidenceScore: item.confidence,
            content: truncatedContent,
          };
          chunks.push({ content: truncatedContent, citation, result: item.result });
          citations.push(citation);
          totalTokens += estimateTokenCount(truncatedContent);
        }
      }
      truncated = true;
      break;
    }

    const citation: SourceCitation = {
      documentId: item.result.document_id,
      filename: item.result.document?.original_filename || 'knowledge base',
      chunkId: item.result.id,
      chunkIndex: item.result.chunk_index,
      pageNumber: item.result.page_number ?? null,
      confidenceScore: item.confidence,
      content,
    };
    chunks.push({ content, citation, result: item.result });
    citations.push(citation);
    totalTokens += contentTokens;
  }

  const maxConfidence = citations.reduce(
    (maximum, citation) => Math.max(maximum, citation.confidenceScore),
    0
  );

  return {
    chunks,
    citations,
    totalTokens,
    truncated,
    hasSufficientContext: maxConfidence >= confidenceThreshold,
    hasConflictingContext: detectConflictingContext(chunks),
  };
}

/**
 * Conservative conflict check: flag exact opposing yes/no statements about the
 * same normalized subject, but do not infer contradictions from arbitrary prose.
 */
function detectConflictingContext(chunks: ContextChunk[]): boolean {
  const normalized = chunks.map((chunk) => chunk.content.toLowerCase());
  for (let index = 0; index < normalized.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < normalized.length; otherIndex += 1) {
      const first = normalized[index];
      const second = normalized[otherIndex];
      const firstNegative = /\b(no|not|never|غير|لا|ليس)\b/.test(first);
      const secondNegative = /\b(no|not|never|غير|لا|ليس)\b/.test(second);
      const firstPositive = /\b(yes|available|accept|متاح|نعم|يقبل)\b/.test(first);
      const secondPositive = /\b(yes|available|accept|متاح|نعم|يقبل)\b/.test(second);
      if (firstPositive && secondNegative || firstNegative && secondPositive) {
        const firstTerms = new Set(first.split(/\s+/).filter((term) => term.length > 3));
        const sharedTerms = second.split(/\s+/).filter((term) => firstTerms.has(term));
        if (sharedTerms.length >= 2) return true;
      }
    }
  }
  return false;
}
