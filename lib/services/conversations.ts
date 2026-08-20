import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Conversation } from '@/types/conversation';

export async function getConversations(clinicId?: string): Promise<Conversation[]> {
  const supabaseServer = createSupabaseServerClient();
  const query = supabaseServer.from('conversations').select('*').order('created_at', { ascending: false }).limit(50);
  const { data, error } = clinicId ? await query.eq('clinic_id', clinicId) : await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Conversation[];
}

export async function createConversation(conversation: Omit<Conversation, 'id'>): Promise<Conversation> {
  const supabaseServer = createSupabaseServerClient();
  const { data, error } = await supabaseServer.from('conversations').insert([conversation]).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Conversation;
}
