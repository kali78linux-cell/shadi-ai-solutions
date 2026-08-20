import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider, isAnthropicConfigured } from '@/lib/ai/providers/anthropic';
import { getProviderHealth, registerProvider, clearProviders } from '@/lib/ai/provider';

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

describe('Anthropic Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real';
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    vi.unstubAllGlobals();
  });

  describe('generate()', () => {
    it('succeeds with a valid provider response', async () => {
      const mockResponse = new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await AnthropicProvider.generate({ prompt: 'Hello' });

      expect(result.text).toBe('Hello world');
      expect(result.promptTokens).toBe(10);
      expect(result.completionTokens).toBe(5);
      expect(result.totalTokens).toBe(15);
      expect(result.model).toBe('claude-haiku-4-5-20251001');
    });

    it('concatenates multiple text blocks', async () => {
      const mockResponse = new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await AnthropicProvider.generate({ prompt: 'Hi' });
      expect(result.text).toBe('Hello world');
    });

    it('uses the configured model from ANTHROPIC_MODEL env', async () => {
      process.env.ANTHROPIC_MODEL = 'claude-sonnet-5';
      const mockResponse = new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Reply' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const fetchMock = vi.fn().mockResolvedValue(mockResponse);
      vi.stubGlobal('fetch', fetchMock);

      const result = await AnthropicProvider.generate({ prompt: 'Hi' });

      expect(result.model).toBe('claude-sonnet-5');
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(requestBody.model).toBe('claude-sonnet-5');
    });

    it('throws when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Anthropic API key is not configured');
    });

    it('throws structured error on 401', async () => {
      const mockResponse = new Response('Invalid API key', { status: 401 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Authentication failed (401)');
    });

    it('throws structured error on 429 rate limit', async () => {
      const mockResponse = new Response('Rate limited', { status: 429 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Rate limited (429)');
    });

    it('throws structured error on 404 possible invalid model', async () => {
      const mockResponse = new Response('model not found', { status: 404 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Resource not found (possible invalid model)');
    });

    it('throws structured error on 503 unavailable', async () => {
      const mockResponse = new Response('overloaded', { status: 503 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('Anthropic unavailable (503)');
    });

    it('throws on empty content array', async () => {
      const mockResponse = new Response(JSON.stringify({ content: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('empty or malformed response');
    });

    it('throws on empty content without refusal stop reason', async () => {
      const mockResponse = new Response(JSON.stringify({
        content: [{ type: 'text', text: '' }],
        usage: {},
        stop_reason: 'end_turn',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('empty response');
    });

    it('throws on invalid JSON response', async () => {
      const mockResponse = new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('empty or malformed response');
    });

    it('throws on timeout', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e); }, 50);
      })));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('timed out');
    });

    it('throws on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      await expect(AnthropicProvider.generate({ prompt: 'Hello' }))
        .rejects.toThrow('network down');
    });

    it('does not leak API key in error messages', async () => {
      const mockResponse = new Response('Invalid sk-ant-test-key-not-real credentials', { status: 401 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      try {
        await AnthropicProvider.generate({ prompt: 'Hello' });
        throw new Error('Expected generate to throw');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Raw API key must never be present
        expect(message).not.toContain('sk-ant-test-key-not-real');
        // Redacted form is safe and expected
        expect(message).toContain('sk-ant-***');
      }
    });
  });

  describe('stream()', () => {
    it('returns a ReadableStream from a valid SSE streaming response', async () => {
      // Simulate Anthropic SSE streaming body
      const sse = [
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n');
      const mockResponse = new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const stream = await AnthropicProvider.stream!({ prompt: 'Hi' });
      expect(stream).toBeInstanceOf(ReadableStream);

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let result = '';
      let chunk = await reader.read();
      while (!chunk.done) {
        result += decoder.decode(chunk.value);
        chunk = await reader.read();
      }
      expect(result).toBe('Hello world');
      vi.unstubAllGlobals();
    });

    it('throws when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(AnthropicProvider.stream!({ prompt: 'Hi' }))
        .rejects.toThrow('Anthropic API key is not configured');
    });

    it('throws on Anthropic error status', async () => {
      const mockResponse = new Response('rate limited', { status: 429 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      await expect(AnthropicProvider.stream!({ prompt: 'Hi' }))
        .rejects.toThrow('Rate limited');
      vi.unstubAllGlobals();
    });
  });

  describe('isAnthropicConfigured', () => {
    it('returns true when API key is set', () => {
      expect(isAnthropicConfigured()).toBe(true);
    });

    it('returns false when API key is missing', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(isAnthropicConfigured()).toBe(false);
    });
  });

  describe('getProviderHealth (provider-aware)', () => {
    it('returns health status for configured anthropic provider', () => {
      process.env.AI_PROVIDER = 'anthropic';
      registerProvider(AnthropicProvider);
      const health = getProviderHealth();
      expect(health.providerId).toBe('anthropic');
      expect(health.configured).toBe(true);
      expect(health.hasApiKey).toBe(true);
      expect(health.message).not.toContain('sk-ant-');
      clearProviders();
      delete process.env.AI_PROVIDER;
    });

    it('returns not-configured health when anthropic key is missing', () => {
      process.env.AI_PROVIDER = 'anthropic';
      delete process.env.ANTHROPIC_API_KEY;
      registerProvider(AnthropicProvider);
      const health = getProviderHealth();
      expect(health.providerId).toBe('anthropic');
      expect(health.configured).toBe(false);
      expect(health.hasApiKey).toBe(false);
      expect(health.message).toContain('ANTHROPIC_API_KEY');
      clearProviders();
      delete process.env.AI_PROVIDER;
    });

    it('never exposes the API key in health message', () => {
      process.env.AI_PROVIDER = 'anthropic';
      registerProvider(AnthropicProvider);
      const health = getProviderHealth();
      expect(health.message).not.toContain('sk-ant-test-key-not-real');
      clearProviders();
      delete process.env.AI_PROVIDER;
    });
  });
});