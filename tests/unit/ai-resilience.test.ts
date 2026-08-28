import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  isTransientAiError,
  failoverCandidates,
  generateWithFailover,
  openStreamWithFailover,
} from '@/lib/ai/resilience';
import { registerProvider, clearProviders } from '@/lib/ai/provider';

const originalEnv = process.env.AI_PROVIDER;

beforeEach(() => {
  clearProviders();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  if (originalEnv === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalEnv;
});

/** Flushes fake-timer backoffs so awaited retries resolve under vitest. */
async function flushBackoff(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await vi.runAllTimersAsync();
}

describe('isTransientAiError — retry/failover classification', () => {
  it('classifies rate limits, timeouts and server errors as transient', () => {
    expect(isTransientAiError(new Error('Rate limited (429) during generate'))).toBe(true);
    expect(isTransientAiError(new Error('Anthropic request timed out'))).toBe(true);
    expect(isTransientAiError(new Error('Anthropic internal error (500)'))).toBe(true);
    expect(isTransientAiError(new Error('fetch failed'))).toBe(true);
  });

  it('classifies auth/permission/malformed as NON-transient', () => {
    expect(isTransientAiError(new Error('Authentication failed (401)'))).toBe(false);
    expect(isTransientAiError(new Error('Permission denied (403)'))).toBe(false);
    expect(isTransientAiError(new Error('Anthropic returned an empty or malformed response'))).toBe(false);
  });
});

describe('failoverCandidates — ordering & Ollama policy', () => {
  it('prefers explicit → configured → other cloud providers', () => {
    process.env.AI_PROVIDER = 'anthropic';
    registerProvider({ id: 'openai', generate: async () => ({ text: '' }) });
    registerProvider({ id: 'ollama', generate: async () => ({ text: '' }) });
    registerProvider({ id: 'anthropic', generate: async () => ({ text: '' }) });

    const ids = failoverCandidates(null).map((c) => c.id);
    expect(ids[0]).toBe('anthropic');
    expect(ids).toContain('openai');
    // Ollama excluded from AUTOMATIC failover unless explicitly configured
    expect(ids).not.toContain('ollama');
  });

  it('includes ollama only when explicitly configured', () => {
    process.env.AI_PROVIDER = 'ollama';
    registerProvider({ id: 'ollama', generate: async () => ({ text: '' }) });
    registerProvider({ id: 'openai', generate: async () => ({ text: '' }) });
    const ids = failoverCandidates(null).map((c) => c.id);
    expect(ids[0]).toBe('ollama');
  });
});

describe('openStreamWithFailover — resilient stream OPEN (STEP 8)', () => {
  it('opens a stream from the primary provider on first attempt', async () => {
    process.env.AI_PROVIDER = 'openai';
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('hi')); c.close(); },
    });
    registerProvider({ id: 'openai', generate: async () => ({ text: '' }), stream: async () => stream });
    const res = await openStreamWithFailover({ prompt: 'p' });
    expect(res.providerId).toBe('openai');
    expect(res.stream).toBe(stream);
  });

  it('retries a transient open failure on the same provider then succeeds', async () => {
    process.env.AI_PROVIDER = 'primary';
    const stream = new ReadableStream({ start(c) { c.close(); } });
    let calls = 0;
    registerProvider({
      id: 'primary',
      generate: async () => ({ text: '' }),
      stream: async () => { calls++; if (calls < 2) throw new Error('Rate limited (429)'); return stream; },
    });
    registerProvider({ id: 'openai', generate: async () => ({ text: '' }), stream: async () => stream });
    const pending = openStreamWithFailover({ prompt: 'p' });
    const res = await Promise.race([pending, flushBackoff().then(() => pending)]);
    expect(res.providerId).toBe('primary');
    expect(calls).toBe(2);
  });

  it('fails over to a secondary provider when the primary stream keeps failing', async () => {
    process.env.AI_PROVIDER = 'primary';
    let primaryCalls = 0;
    registerProvider({
      id: 'primary',
      generate: async () => ({ text: '' }),
      stream: async () => { primaryCalls++; throw new Error('Anthropic request timed out'); },
    });
    const stream = new ReadableStream({ start(c) { c.close(); } });
    registerProvider({ id: 'openai', generate: async () => ({ text: '' }), stream: async () => stream });
    const pending = openStreamWithFailover({ prompt: 'p' });
    const res = await Promise.race([pending, flushBackoff().then(() => pending)]);
    expect(res.providerId).toBe('openai');
    expect(primaryCalls).toBe(2);
  });

  it('throws when every provider stream fails (graceful degradation keeps working)', async () => {
    process.env.AI_PROVIDER = 'a';
    registerProvider({ id: 'a', generate: async () => ({ text: '' }), stream: async () => { throw new Error('Rate limited (429)'); } });
    registerProvider({ id: 'b', generate: async () => ({ text: '' }), stream: async () => { throw new Error('internal error (500)'); } });
    const pending = openStreamWithFailover({ prompt: 'p' });
    await expect(Promise.race([pending, flushBackoff().then(() => pending)])).rejects.toThrow('internal error (500)');
  });

  it('skips candidates that do not implement stream()', async () => {
    process.env.AI_PROVIDER = 'text-only';
    registerProvider({ id: 'text-only', generate: async () => ({ text: '' }) }); // no stream
    const stream = new ReadableStream({ start(c) { c.close(); } });
    registerProvider({ id: 'openai', generate: async () => ({ text: '' }), stream: async () => stream });
    const res = await openStreamWithFailover({ prompt: 'p' });
    expect(res.providerId).toBe('openai');
  });
});

describe('generateWithFailover — resilience paths', () => {
  it('retries a transient failure on the SAME provider then succeeds', async () => {
    process.env.AI_PROVIDER = 'primary';
    let calls = 0;
    registerProvider({
      id: 'primary',
      generate: async () => {
        calls++;
        if (calls < 2) throw new Error('Rate limited (429)');
        return { text: 'ok', totalTokens: 1 };
      },
    });

    const pending = generateWithFailover({ prompt: 'p' });
    const result = await Promise.race([pending, flushBackoff().then(() => pending)]);
    expect(result.text).toBe('ok');
    expect(result.providerId).toBe('primary');
    expect(calls).toBe(2);
  });

  it('fails over to the secondary provider when primary keeps failing', async () => {
    process.env.AI_PROVIDER = 'primary';
    let primaryCalls = 0;
    registerProvider({
      id: 'primary',
      generate: async () => {
        primaryCalls++;
        throw new Error('Anthropic request timed out');
      },
    });
    registerProvider({ id: 'openai', generate: async () => ({ text: 'from-secondary' }) });

    const pending = generateWithFailover({ prompt: 'p' });
    const result = await Promise.race([pending, flushBackoff().then(() => pending)]);
    expect(result.text).toBe('from-secondary');
    expect(result.providerId).toBe('openai');
    expect(primaryCalls).toBe(2); // bounded retries before failing over
  });

  it('does NOT waste retries on non-transient errors — fails over immediately', async () => {
    process.env.AI_PROVIDER = 'broken-auth';
    let calls = 0;
    registerProvider({
      id: 'broken-auth',
      generate: async () => {
        calls++;
        throw new Error('Authentication failed (401)');
      },
    });
    registerProvider({ id: 'openai', generate: async () => ({ text: 'secondary-ok' }) });

    const pending = generateWithFailover({ prompt: 'p' });
    const result = await Promise.race([pending, flushBackoff(2).then(() => pending)]);
    expect(result.providerId).toBe('openai');
    expect(calls).toBe(1);
  });

  it('throws the last error when every provider fails (handoff stays the last resort)', async () => {
    process.env.AI_PROVIDER = 'a';
    registerProvider({ id: 'a', generate: async () => { throw new Error('Rate limited (429)'); } });
    registerProvider({ id: 'b', generate: async () => { throw new Error('internal error (500)'); } });

    const pending = generateWithFailover({ prompt: 'p' });
    await expect(Promise.race([pending, flushBackoff().then(() => pending)])).rejects.toThrow('internal error (500)');
  });
});
