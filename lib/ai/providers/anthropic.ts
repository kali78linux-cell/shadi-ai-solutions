import { AIProvider, GenerateParams, GenerateResult } from '../provider';
import { logEvent } from '@/lib/server/logging';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
/**
 * Structural timeout aligned with the patient-response latency goal (3–5s max).
 * A patient reply must arrive within seconds, not a minute.
 */
const REQUEST_TIMEOUT_MS = 5_000;

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
      throw new Error('Anthropic request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Builds a structured error from a non-OK Anthropic response.
 * Never includes the API key. Includes status and safe body excerpt.
 */
async function buildProviderError(response: Response, operation: string): Promise<Error> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    bodyText = '(response body unavailable)';
  }

  // Strip any potential secret-like patterns
  const safeBody = bodyText
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, 'sk-ant-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .slice(0, 500);

  let errorType = 'Anthropic error';
  switch (response.status) {
    case 401: errorType = 'Authentication failed'; break;
    case 403: errorType = 'Permission denied'; break;
    case 404: errorType = 'Resource not found (possible invalid model)'; break;
    case 429: errorType = 'Rate limited'; break;
    case 500: errorType = 'Anthropic internal error'; break;
    case 502:
    case 503:
    case 504: errorType = 'Anthropic unavailable'; break;
  }

  return new Error(`${errorType} (${response.status}) during ${operation}: ${safeBody}`);
}

/**
 * Validates an Anthropic Messages API response and extracts the text + usage.
 *
 * Anthropic /v1/messages returns:
 * {
 *   "content": [{ "type": "text", "text": "..." }],
 *   "usage": { "input_tokens": N, "output_tokens": M },
 *   "model": "..."
 * }
 */
function parseGenerateResponse(json: unknown): { text: string; promptTokens: number; completionTokens: number; totalTokens: number; model?: string } {
  if (!json || typeof json !== 'object') {
    throw new Error('Anthropic returned an empty or malformed response: expected JSON object');
  }

  const data = json as Record<string, unknown>;
  const content = data.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('Anthropic returned an empty or malformed response: missing content array');
  }

  // Concatenate all text blocks (content may contain text + tool_use blocks)
  const text = content
    .map((block) => {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') return b.text;
      }
      return '';
    })
    .join('')
    .trim();

  if (!text) {
    // Allow empty text only if the model returned a stop_reason indicating refusal/block
    const stopReason = data.stop_reason;
    if (stopReason !== 'refusal' && stopReason !== 'max_tokens') {
      throw new Error('Anthropic returned an empty response: no content in message');
    }
  }

  const usage = data.usage as Record<string, unknown> | undefined;
  const promptTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0;
  const completionTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0;
  const totalTokens = promptTokens + completionTokens;
  const model = typeof data.model === 'string' ? data.model : undefined;

  return { text, promptTokens, completionTokens, totalTokens, model };
}

/**
 * Converts an Anthropic streaming SSE response into a ReadableStream.
 * Anthropic streams `content_block_delta` events with a `text` field.
 */
function createAnthropicStream(response: Response): ReadableStream<Uint8Array> {
  const reader = response.body?.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      if (!reader) {
        controller.error(new Error('Anthropic returned no response body'));
        return;
      }
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by blank lines
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const event of events) {
            for (const line of event.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const json = JSON.parse(payload);
                if (json.type === 'content_block_delta' && typeof json.delta?.text === 'string') {
                  controller.enqueue(encoder.encode(json.delta.text));
                }
              } catch {
                // Skip malformed/partial event — provider streams can split JSON
              }
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

export const AnthropicProvider: AIProvider = {
  id: 'anthropic',

  async generate({ prompt, maxTokens = 1024, temperature = 0.2 }): Promise<GenerateResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY in the environment.');
    }

    const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    };

    const res = await fetchWithTimeout(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await buildProviderError(res, 'generate');
      logEvent('anthropic_generate_error', { status: res.status, model, error: err.message }, 'error');
      throw err;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      logEvent('anthropic_generate_parse_error', { error: 'Invalid JSON from Anthropic' }, 'error');
      throw new Error('Anthropic returned an empty or malformed response: invalid JSON');
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

  async stream({ prompt, maxTokens = 1024, temperature = 0.2 }): Promise<ReadableStream<Uint8Array>> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY in the environment.');
    }

    const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    };

    const res = await fetchWithTimeout(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await buildProviderError(res, 'stream');
      logEvent('anthropic_stream_error', { status: res.status, model, error: err.message }, 'error');
      throw err;
    }

    return createAnthropicStream(res);
  },

  // Anthropic does not provide a compatible embeddings endpoint for the RAG
  // pipeline. When AI_PROVIDER=anthropic, vector search falls back to
  // keyword-only retrieval (same behavior as Ollama).
};

/**
 * Returns whether the Anthropic provider is configured (API key present).
 * Never returns the key itself.
 */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}