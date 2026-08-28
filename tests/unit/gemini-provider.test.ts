import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '@/lib/ai/providers/gemini';

describe('GeminiProvider embeddings', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('requests a 1536-dimensional embedding compatible with clinic_ai_knowledge', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const vector = Array.from({ length: 1536 }, () => 0.01);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embedding: { values: vector } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await GeminiProvider.embed!('معلومة عربية عن العيادة');

    expect(result.embedding).toHaveLength(1536);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(':embedContent?key='), expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({ outputDimensionality: 1536 }));
  });
});
