import { AIProvider, GenerateParams, GenerateResult, EmbedResult } from '../provider';
import { getSupabaseEnvConfig } from '@/lib/config';

const env = getSupabaseEnvConfig();

export const OpenAIProvider: AIProvider = {
  id: 'openai',
  async generate({ prompt, maxTokens = 512, temperature = 0.2 }): Promise<GenerateResult> {
    const key = typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined;
    if (!key) throw new Error('OpenAI API key not configured on server');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI request failed: ${res.status} ${txt}`);
    }

    const json = await res.json();
    const text = (json.choices && json.choices[0] && json.choices[0].message?.content) || '';
    const usage = json.usage?.total_tokens ?? undefined;
    return { text, tokens: usage, model: json.model, raw: json } as GenerateResult;
  },
  async embed(input: string): Promise<EmbedResult> {
    const key = typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined;
    if (!key) throw new Error('OpenAI API key not configured on server');

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI embed request failed: ${res.status} ${txt}`);
    }

    const json = await res.json();
    const embedding = json.data?.[0]?.embedding ?? [];
    return { embedding, raw: json } as EmbedResult;
  },
};
