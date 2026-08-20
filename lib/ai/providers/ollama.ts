import { AIProvider, GenerateParams, GenerateResult } from '../provider';
import { logEvent } from '@/lib/server/logging';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Fetches with a timeout using AbortController.
 * Throws a structured Error on timeout.
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Ollama request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Builds a structured error from a non-OK Ollama response.
 */
async function buildProviderError(response: Response, operation: string): Promise<Error> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    bodyText = '(response body unavailable)';
  }

  const safeBody = bodyText.slice(0, 500);

  let errorType = 'Ollama error';
  switch (response.status) {
    case 404: errorType = 'Model not found (invalid model name)'; break;
    case 429: errorType = 'Ollama is busy (rate limited)'; break;
    case 500: errorType = 'Ollama internal error'; break;
    case 503: errorType = 'Ollama unavailable'; break;
  }

  return new Error(`${errorType} (${response.status}) during ${operation}: ${safeBody}`);
}

/**
 * Validates an Ollama generate response and extracts the text + usage.
 */
function parseGenerateResponse(json: unknown): { text: string; promptTokens: number; completionTokens: number; totalTokens: number; model?: string } {
  if (!json || typeof json !== 'object') {
    throw new Error('Ollama returned an empty or malformed response: expected JSON object');
  }

  const data = json as Record<string, unknown>;
  const text = typeof data.response === 'string' && data.response.trim() !== '' ? data.response.trim() : '';

  if (!text) {
    throw new Error('Ollama returned an empty response: no content in response field');
  }

  const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0;
  const completionTokens = typeof data.eval_count === 'number' ? data.eval_count : 0;
  const model = typeof data.model === 'string' ? data.model : undefined;

  return {
    text,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    model,
  };
}

/**
 * Checks whether an Ollama model exists on the server.
 * Returns true when the server is reachable and the model is listed.
 */
async function modelExists(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: 'GET' }, 10_000);
    if (!res.ok) return false;
    const json = await res.json() as { models?: Array<{ name?: string }> };
    const models = Array.isArray(json.models) ? json.models : [];
    return models.some((m) => m.name === model);
  } catch {
    return false;
  }
}

/**
 * Converts an Ollama streaming NDJSON response into a ReadableStream.
 * Each JSON line contains a `response` field with incremental text chunks.
 */
function createOllamaStream(response: Response): ReadableStream<Uint8Array> {
  const reader = response.body?.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      if (!reader) {
        controller.error(new Error('Ollama returned no response body'));
        return;
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Ollama streams multiple JSON objects separated by newlines
          for (const line of chunk.split('\n')) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (typeof json.response === 'string' && json.response) {
                controller.enqueue(encoder.encode(json.response));
              }
            } catch {
              // Skip malformed/partial line — provider streams can split JSON
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export const OllamaProvider: AIProvider = {
  id: 'ollama',

  async generate({ prompt, maxTokens = 2048, temperature = 0.2 }): Promise<GenerateResult> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    const model = process.env.OLLAMA_MODEL;

    if (!model) {
      throw new Error('Ollama model is not configured. Set OLLAMA_MODEL in the environment.');
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    };

    const res = await fetchWithTimeout(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await buildProviderError(res, 'generate');
      logEvent('ollama_generate_error', { status: res.status, model, error: err.message }, 'error');
      throw err;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      logEvent('ollama_generate_parse_error', { error: 'Invalid JSON from Ollama' }, 'error');
      throw new Error('Ollama returned an empty or malformed response: invalid JSON');
    }

    const parsed = parseGenerateResponse(json);

    return {
      text: parsed.text,
      promptTokens: parsed.promptTokens,
      completionTokens: parsed.completionTokens,
      totalTokens: parsed.totalTokens,
      model: parsed.model,
      raw: json,
    };
  },

  /**
   * Streaming support for Ollama.
   * Returns a ReadableStream of text chunks. Ollama sends NDJSON with a
   * `response` field per line containing incremental generated text.
   */
  async stream({ prompt, maxTokens = 2048, temperature = 0.2 }): Promise<ReadableStream<Uint8Array>> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    const model = process.env.OLLAMA_MODEL;

    if (!model) {
      throw new Error('Ollama model is not configured. Set OLLAMA_MODEL in the environment.');
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      stream: true,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    };

    const res = await fetchWithTimeout(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await buildProviderError(res, 'stream');
      logEvent('ollama_stream_error', { status: res.status, model, error: err.message }, 'error');
      throw err;
    }

    return createOllamaStream(res);
  },

  // Ollama model qwen2.5-coder:14b does NOT support embeddings.
  // The RAG pipeline requires embedding; when AI_PROVIDER=ollama is used,
  // the vector search fallback must rely on keyword search only.
};

/**
 * Returns the configured Ollama model name, or null if not set.
 */
export function getOllamaConfig(): { baseUrl: string; model: string | null } {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL,
    model: process.env.OLLAMA_MODEL ?? null,
  };
}

/**
 * Returns whether the Ollama provider is configured (model is set).
 */
export function isOllamaConfigured(): boolean {
  return Boolean(process.env.OLLAMA_MODEL);
}

/**
 * Performs a real connectivity check against a running Ollama server.
 * Returns whether the configured model exists.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const { baseUrl, model } = getOllamaConfig();
  if (!model) return false;
  return modelExists(baseUrl, model);
}