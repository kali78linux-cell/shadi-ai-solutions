/**
 * Language detection and multilingual retrieval utilities.
 *
 * Supports Arabic (ar), English (en), and mixed-language queries.
 * Provides language detection, query translation hints, and
 * cross-language retrieval where supported.
 */

/** Supported language codes. */
export type SupportedLanguage = 'en' | 'ar' | 'unknown';

/**
 * Detects the primary language of a text string.
 * Uses character-set heuristics for fast, dependency-free detection.
 *
 * @param text The text to analyze.
 * @returns The detected language code ('en', 'ar', or 'unknown').
 */
export function detectLanguage(text: string): SupportedLanguage {
  if (!text || !text.trim()) return 'unknown';

  const trimmed = text.trim();

  // Arabic script detection: Arabic characters are in the range U+0600–U+06FF
  const arabicChars = trimmed.match(/[\u0600-\u06FF]/g);
  const latinChars = trimmed.match(/[A-Za-z]/g);

  if (arabicChars && arabicChars.length > 0) {
    // If there are Arabic characters, check if it's predominantly Arabic
    const arabicRatio = arabicChars.length / trimmed.length;
    if (arabicRatio > 0.3) {
      return 'ar';
    }
  }

  if (latinChars && latinChars.length > 0) {
    const latinRatio = latinChars.length / trimmed.length;
    if (latinRatio > 0.5) {
      return 'en';
    }
  }

  // Mixed language: if both Arabic and Latin are present, return 'unknown'
  // and let the retrieval system handle cross-language search.
  if (arabicChars && latinChars) {
    return 'unknown';
  }

  return 'unknown';
}

/**
 * Determines whether a query is mixed-language (contains both Arabic and Latin scripts).
 * @param text The query text.
 * @returns True if the query contains both Arabic and Latin characters.
 */
export function isMixedLanguage(text: string): boolean {
  if (!text || !text.trim()) return false;
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  return hasArabic && hasLatin;
}

/**
 * Generates language-specific query variants for cross-language retrieval.
 * For mixed-language queries, this can produce transliterated or translated
 * variants to improve recall across language boundaries.
 *
 * @param query The original query text.
 * @returns An array of query variants to search with.
 */
export function generateQueryVariants(query: string): string[] {
  const variants: string[] = [query];
  const lang = detectLanguage(query);

  if (lang === 'unknown' && isMixedLanguage(query)) {
    // For mixed-language queries, also try the Arabic-only and Latin-only portions
    const arabicOnly = query.replace(/[A-Za-z\s\d]+/g, '').trim();
    const latinOnly = query.replace(/[\u0600-\u06FF\s\d]+/g, '').trim();

    if (arabicOnly) variants.push(arabicOnly);
    if (latinOnly) variants.push(latinOnly);
  }

  return variants;
}

/**
 * Determines the appropriate language filter for retrieval based on the query.
 * Returns undefined (no filter) for mixed-language queries to allow cross-language retrieval.
 *
 * @param query The user's query text.
 * @returns The language code to filter by, or undefined for no filter.
 */
export function getRetrievalLanguage(query: string): SupportedLanguage | undefined {
  const lang = detectLanguage(query);
  if (lang === 'unknown') {
    // For mixed-language or unknown, don't filter by language
    return undefined;
  }
  return lang;
}
