import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider, isOpenAIConfigured } from '@/lib/ai/providers/openai';
import { getProviderHealth, registerProvider, clearProviders } from '@/lib/ai/provider';

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

describe('OpenAI Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test-key-not-real';
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_EMBED_MODEL;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_EMBED_MODEL;
    vi.unstubAllGlobals();
  });

  describe('generate()', () => {
    it('succeeds with a valid provider response', async () => {
      const mockResponse = new Response(JSON.stringify({
        choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o-mini',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await OpenAIProvider.generate({ prompt: 'Hello' });

      expect(result.text).toBe('Hello world');
      expect(result.promptTokens).toBe(10);
      expect(result.completionTokens).toBe(5);
      expect(result.totalTokens).toBe(15);
      expect(result.model).toBe('gpt-4o-mini');
    });

    it('throws when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('OpenAI API key is not configured');
    });

    it('throws structured error on 401', async () => {
      const mockResponse = new Response('Invalid API key', { status: 401 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Authentication failed (401)');
    });

    it('throws structured error on 429 rate limit', async () => {
      const mockResponse = new Response('Too many requests', { status: 429 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Rate limited (429)');
    });

    it('throws structured error on 503 unavailable', async () => {
      const mockResponse = new Response('Server overloaded', { status: 503 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Provider unavailable (503)');
    });

    it('throws structured error on 500 internal error', async () => {
      const mockResponse = new Response('Internal error', { status: 500 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Provider internal error (500)');
    });

    it('throws on empty response body (empty choices)', async () => {
      const mockResponse = new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('empty or malformed response');
    });

    it('throws on empty content without content_filter reason', async () => {
      const mockResponse = new Response(JSON.stringify({
        choices: [{ message: { content: '' }, finish_reason: 'stop' }],
        usage: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('empty or malformed response');
    });

    it('throws on invalid JSON response', async () => {
      const mockResponse = new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('empty or malformed response');
    });

    it('throws on timeout', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e); }, 50);
      })));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('timed out');
    });

    it('throws on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      await expect(OpenAIProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('network down');
    });

    it('does not leak API key in error messages', async () => {
      const mockResponse = new Response('Invalid sk-test-key-not-real credentials', { status: 401 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      try {
        await OpenAIProvider.generate({ prompt: 'Hello' });
        throw new Error('Expected generate to throw');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Raw API key must never be present
        expect(message).not.toContain('sk-test-key-not-real');
        // Redacted form is safe and expected
        expect(message).toContain('sk-***');
      }
    });
  });

  describe('embed()', () => {
    it('succeeds with a valid embedding response', async () => {
      const mockResponse = new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await OpenAIProvider.embed!('text');

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('throws when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(OpenAIProvider.embed!('text'))
        .rejects.toThrow('OpenAI API key is not configured');
    });

    it('throws on empty embedding response', async () => {
      const mockResponse = new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(OpenAIProvider.embed!('text'))
        .rejects.toThrow('empty or malformed embedding response');
    });
  });

  describe('isOpenAIConfigured', () => {
    it('returns true when API key is set', () => {
      expect(isOpenAIConfigured()).toBe(true);
    });

    it('returns false when API key is missing', () => {
      delete process.env.OPENAI_API_KEY;
      expect(isOpenAIConfigured()).toBe(false);
    });
  });

  describe('getProviderHealth', () => {
    it('returns health status with configured provider', () => {
      registerProvider(OpenAIProvider);
      const health = getProviderHealth();
      expect(health.providerId).toBe('openai');
      expect(health.configured).toBe(true);
      expect(health.hasApiKey).toBe(true);
      expect(health.message).not.toContain('sk-');
      clearProviders();
    });

    it('returns not-configured health when no provider is registered', () => {
      clearProviders();
      const health = getProviderHealth();
      expect(health.configured).toBe(false);
      expect(health.providerId).toBeNull();
    });

    it('never exposes the API key in health message', () => {
      registerProvider(OpenAIProvider);
      const health = getProviderHealth();
      expect(health.message).not.toContain('sk-test-key-not-real');
      clearProviders();
    });
  });
});