import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * ROOT-CAUSE REGRESSION CONTRACT
 * The public visitor chat UI must NEVER call the authenticated /api/ai/messages
 * route: anonymous visitors get 401 there, which surfaced as the misleading
 * "مساعد غير متاح" bubble for ARBITRARY messages. Endpoint selection by
 * guessing the identifier's shape (uuid => auth route) is banned.
 */
const src = readFileSync('components/chat/ChatInterface.tsx', 'utf8');

const nonPublicRefs =
  src.match(/(?<!\/public)\/api\/ai\/(?:messages|conversations)/g) ?? [];

describe('chat endpoint contract (visitor UI)', () => {
  it('never references the authenticated AI routes', () => {
    expect(nonPublicRefs).toEqual([]);
  });

  it('uses the public messages route for patient traffic', () => {
    expect(src.includes('/api/public/ai/messages')).toBe(true);
  });
});
