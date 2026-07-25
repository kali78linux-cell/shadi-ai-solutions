import { supabase } from '@/lib/supabase';
import { vectorSearchClinic } from '@/lib/services/knowledgeService';
import { getProvider } from './provider';

const provider = getProvider('openai');

export async function retrieveContext(clinicId: string, query: string, limit = 5) {
  // Generate embedding for query, then vector search within clinic
  let qEmb: number[] | null = null;
  try {
    const emb = provider.embed ? await provider.embed(query) : null;
    qEmb = emb ? emb.embedding : null;
  } catch (e) {
    console.error('embed error', e);
  }

  if (!qEmb) {
    // fallback to simple text search
    const { data, error } = await supabase
      .from('clinic_ai_knowledge')
      .select('id, title, content, structured_data, subtype, metadata')
      .ilike('content', `%${query}%`)
      .eq('clinic_id', clinicId)
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  const scored = await vectorSearchClinic(clinicId, qEmb, limit);
  return scored;
}
