import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ROOT-FIX TRIPWIRE (intermittent "المساعد غير متاح حاليًا").
 *
 * Proven root cause: ChatInterface chose its API endpoint by GUESSING the
 * identifier shape (`uuid → /api/ai/messages`). The clinic gate resolves the
 * slug to a real clinic UUID, so every visitor message went to the AUTHENTICATED
 * staff route and came back 401 — displayed as the generic assistant-unavailable
 * error. Message content was irrelevant (hence the "random" failures).
 *
 * This public visitor widget must ALWAYS use the public route
 * (/api/public/ai/messages), which resolves + scopes the clinic server-side via
 * resolvePublicClinic. These assertions make a silent regression impossible.
 */

const interfaceSource = readFileSync(
  path.join(process.cwd(), 'components/chat/ChatInterface.tsx'),
  'utf8'
);

describe('public chat endpoint routing (regression tripwire)', () => {
  it('never references the authenticated staff messages route', () => {
    expect(interfaceSource.includes("'/api/ai/messages'")).toBe(false);
    expect(interfaceSource.includes('"/api/ai/messages"')).toBe(false);
    expect(interfaceSource.includes('`/api/ai/messages')).toBe(false);
  });

  it('routes message traffic through the public visitor endpoint', () => {
    expect(interfaceSource).toContain('/api/public/ai/messages');
  });
});