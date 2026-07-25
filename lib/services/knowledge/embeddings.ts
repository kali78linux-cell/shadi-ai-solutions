import { getProvider } from '@/lib/ai/provider';

export async function embedText(text: string) {
  const provider = getProvider();
  if (!provider || !provider.embed) throw new Error('No embedding provider configured');
  const res = await provider.embed(text);
  return res.embedding;
}
