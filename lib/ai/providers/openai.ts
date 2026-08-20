import { AIProvider, GenerateParams, GenerateResult, EmbedResult } from '../provider';
import { logEvent } from '@/lib/server/logging';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fetches with a timeout using AbortController.
 * Throws an Error with a structured message on timeout.
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AI provider request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parses a structured error from a non-OK provider response.
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
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .slice(0, 500);

  let errorType = 'Provider error';
  switch (response.status) {
    case 401: errorType = 'Authentication failed'; break;
    case 403: errorType = 'Permission denied'; break;
    case 404: errorType = 'Resource not found (possible invalid model)'; break;
    case 429: errorType = 'Rate limited'; break;
    case 500: errorType = 'Provider internal error'; break;
    case 502:
    case 503:
    case 504: errorType = 'Provider unavailable'; break;
  }

  return new Error(`${errorType} (${response.status}) during ${operation}: ${safeBody}`);
}

/**
 * Validates a provider response and extracts the text.
 * Throws a clear error if the response is empty or malformed.
 */
function parseGenerateResponse(json: unknown): { text: string; promptTokens: number; completionTokens: number; totalTokens: number; model?: string } {
  if (!json || typeof json !== 'object') {
    throw new Error('AI provider returned an empty or malformed response: expected JSON object');
  }

  const data = json as Record<string, unknown>;
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('AI provider returned an empty or malformed response: missing choices array');
  }

  const firstChoice = choices[0] as Record<string, unknown>;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const text = typeof message?.content === 'string' ? message.content.trim() : '';

  // Allow empty text only if the model returned a refusal or content filter
  const finishReason = firstChoice?.finish_reason as string | undefined;
  if (!text && finishReason !== 'content_filter') {
    throw new Error('AI provider returned an empty or malformed response: no content in message');
  }

  const usage = data.usage as Record<string, unknown> | undefined;
  const promptTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens;
  const model = typeof data.model === 'string' ? data.model : undefined;

  return { text, promptTokens, completionTokens, totalTokens, model };
}

function validateEmbedResponse(json: unknown): number[] {
  if (!json || typeof json !== 'object') {
    throw new Error('AI provider returned an empty or malformed embedding response: expected JSON object');
  }
  const data = json as Record<string, unknown>;
  const rows = data.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('AI provider returned an empty or malformed embedding response: missing data array');
  }
  const first = rows[0] as Record<string, unknown>;
  const embedding = first.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('AI provider returned an empty or malformed embedding response: missing embedding vector');
  }
  return embedding as number[];
}

export const OpenAIProvider: AIProvider = {
  id: 'openai',

  async generate({ prompt, maxTokens = 512, temperature = 0.2 }): Promise<GenerateResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY in the environment.');

    const res = await fetchWithTimeout(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await buildProviderError(res, 'generate');
      logEvent('openai_generate_error', { status: res.status, error: err.message }, 'error');
      throw err;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      logEvent('openai_generate_parse_error', { error: 'Invalid JSON from provider' }, 'error');
      throw new Error('AI provider returned an empty or malformed response: invalid JSON');
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

  async embed(input: string): Promise<EmbedResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY in the environment.');

    const res = await fetchWithTimeout(OPENAI_EMBED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: process.env.OPENAI_EMBED_MODEL ?? DEFAULT_EMBED_MODEL, input }),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await buildProviderError(res, 'embed');
      logEvent('openai_embed_error', { status: res.status, error: err.message }, 'error');
      throw err;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      logEvent('openai_embed_parse_error', { error: 'Invalid JSON from provider' }, 'error');
      throw new Error('AI provider returned an empty or malformed embedding response: invalid JSON');
    }

    const embedding = validateEmbedResponse(json);
    return { embedding, raw: json };
  },
};

/**
 * Returns whether the OpenAI provider is configured (API key present).
 * Never returns the key itself.
 */
export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}