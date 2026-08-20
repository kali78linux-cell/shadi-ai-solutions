import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider, isOllamaConfigured, isOllamaAvailable, getOllamaConfig } from '@/lib/ai/providers/ollama';

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

describe('Ollama Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OLLAMA_MODEL = 'qwen2.5-coder:14b';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  });

  afterEach(() => {
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BASE_URL;
    vi.unstubAllGlobals();
  });

  describe('generate()', () => {
    it('succeeds with a valid provider response', async () => {
      const mockResponse = new Response(JSON.stringify({
        model: 'qwen2.5-coder:14b',
        response: 'Hello there!',
        prompt_eval_count: 12,
        eval_count: 8,
        done: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await OllamaProvider.generate({ prompt: 'Hi' });

      expect(result.text).toBe('Hello there!');
      expect(result.promptTokens).toBe(12);
      expect(result.completionTokens).toBe(8);
      expect(result.totalTokens).toBe(20);
      expect(result.model).toBe('qwen2.5-coder:14b');
    });

    it('throws when model is not configured', async () => {
      delete process.env.OLLAMA_MODEL;
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('Ollama model is not configured');
    });

    it('throws structured error when Ollama is unavailable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('ECONNREFUSED');
    });

    it('throws structured error on model not found (404)', async () => {
      const mockResponse = new Response('model not found', { status: 404 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('Model not found (invalid model name)');
    });

    it('throws structured error on 503 unavailable', async () => {
      const mockResponse = new Response('server unavailable', { status: 503 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('Ollama unavailable (503)');
    });

    it('throws on empty response', async () => {
      const mockResponse = new Response(JSON.stringify({ model: 'qwen2.5-coder:14b', response: '', done: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('empty response');
    });

    it('throws on malformed JSON response', async () => {
      const mockResponse = new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('empty or malformed response');
    });

    it('throws on timeout', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e); }, 50);
      })));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('timed out');
    });

    it('throws on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      await expect(OllamaProvider.generate({ prompt: 'Hi' }))
        .rejects.toThrow('network down');
    });
  });

  describe('stream()', () => {
    it('returns a ReadableStream from a valid streaming response', async () => {
      // Simulate Ollama NDJSON streaming body
      const ndjson = '{"response":"Hello","done":false}\n{"response":" world","done":true}\n';
      const mockResponse = new Response(ndjson, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const stream = await OllamaProvider.stream!({ prompt: 'Hi' });
      expect(stream).toBeInstanceOf(ReadableStream);
      vi.unstubAllGlobals();
    });

    it('throws when model is not configured', async () => {
      delete process.env.OLLAMA_MODEL;
      await expect(OllamaProvider.stream!({ prompt: 'Hi' }))
        .rejects.toThrow('Ollama model is not configured');
    });

    it('throws on Ollama error status', async () => {
      const mockResponse = new Response('model not found', { status: 404 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      await expect(OllamaProvider.stream!({ prompt: 'Hi' }))
        .rejects.toThrow('Model not found');
      vi.unstubAllGlobals();
    });
  });

  describe('isOllamaConfigured', () => {
    it('returns true when model is set', () => {
      expect(isOllamaConfigured()).toBe(true);
    });

    it('returns false when model is missing', () => {
      delete process.env.OLLAMA_MODEL;
      expect(isOllamaConfigured()).toBe(false);
    });
  });

  describe('getOllamaConfig', () => {
    it('returns the configured base URL and model', () => {
      const config = getOllamaConfig();
      expect(config.baseUrl).toBe('http://127.0.0.1:11434');
      expect(config.model).toBe('qwen2.5-coder:14b');
    });

    it('returns null model when not set', () => {
      delete process.env.OLLAMA_MODEL;
      expect(getOllamaConfig().model).toBeNull();
    });
  });

  describe('isOllamaAvailable', () => {
    it('returns false when model is missing', async () => {
      delete process.env.OLLAMA_MODEL;
      expect(await isOllamaAvailable()).toBe(false);
    });

    it('returns true when server is reachable and model exists', async () => {
      const mockResponse = new Response(JSON.stringify({
        models: [{ name: 'qwen2.5-coder:14b' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      expect(await isOllamaAvailable()).toBe(true);
    });

    it('returns false when server is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      expect(await isOllamaAvailable()).toBe(false);
    });

    it('returns false when model is not installed', async () => {
      const mockResponse = new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
      expect(await isOllamaAvailable()).toBe(false);
    });
  });
});