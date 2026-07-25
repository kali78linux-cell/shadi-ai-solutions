import { extractTextFromBuffer, chunkText } from '@/lib/ai/docParser';

export async function parseFileBuffer(buffer: Buffer, filename?: string) {
  const text = await extractTextFromBuffer(buffer, filename);
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const chunks = chunkText(cleaned, 800, 200);
  return chunks;
}
