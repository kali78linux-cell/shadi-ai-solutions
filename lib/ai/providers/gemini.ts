import { AIProvider, EmbedResult, GenerateParams, GenerateResult } from '../provider';
import { logEvent } from '@/lib/server/logging';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// `gemini-flash-lite-latest` is available to this project's Free Tier key.
const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 1536;
// Measured real-world latency on this project's Free Tier key reaches 7–11s
// under ordinary load; the old 15s cap left near-zero headroom (AbortError →
// opaque 500 → frontend showed "المساعد غير متاح" for messages that were only
// SLOW, not broken). 30s matches ollama's ceiling and keeps generation safe.
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function providerError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => 'response body unavailable');
  const safeBody = body
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza***')
    .slice(0, 500);
  const type = response.status === 401 || response.status === 403
    ? 'Authentication failed'
    : response.status === 429
      ? 'Rate limited'
      : response.status >= 500
        ? 'Gemini unavailable'
        : 'Gemini error';
  return new Error(`${type} (${response.status}) during generate: ${safeBody}`);
}

export const GeminiProvider: AIProvider = {
  id: 'gemini',

  async generate({ prompt, maxTokens = 1024, temperature = 0.2 }): Promise<GenerateResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini API key is not configured. Set GEMINI_API_KEY in the environment.');

    const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      }),
    });

    if (!response.ok) {
      const error = await providerError(response);
      logEvent('gemini_generate_error', { status: response.status, model, error: error.message }, 'error');
      throw error;
    }

    const json = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      modelVersion?: string;
    };
    const text = json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini returned an empty or malformed response');

    const promptTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      promptTokens,
      completionTokens,
      totalTokens: json.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens,
      model: json.modelVersion ?? model,
      raw: json,
    };
  },

  async embed(input: string): Promise<EmbedResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini API key is not configured.');

    const model = process.env.GEMINI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(key)}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: input }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const error = await providerError(response);
      logEvent('gemini_embed_error', { status: response.status, model, error: error.message }, 'error');
      throw error;
    }

    const json = await response.json() as { embedding?: { values?: unknown } };
    const embedding = json.embedding?.values;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every((value) => typeof value === 'number')) {
      throw new Error('Gemini returned an invalid embedding response');
    }

    return { embedding, raw: json };
  },
};

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
