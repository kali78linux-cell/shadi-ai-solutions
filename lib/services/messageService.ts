import { supabaseAdmin } from '@/lib/supabase/admin';
import { Message } from '@/types/db';
import { handleIncomingMessage } from '@/lib/ai/orchestrator';

export async function saveMessage(payload: {
  conversation_id: string | null;
  clinic_id: string;
  role: 'patient' | 'assistant' | 'staff' | 'system';
  sender_id?: string | null;
  content?: string | null;
  content_json?: Record<string, unknown> | null;
}) {
  const { data, error } = await supabaseAdmin.from('messages').insert([payload]).select('*').single();
  if (error) throw error;
  return data;
}

export async function getConversationHistory(conversationId: string, limit = 10): Promise<Pick<Message, 'role' | 'content'>[]> {
  const { data, error } = await supabaseAdmin.from('messages').select('role, content').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as Pick<Message, 'role' | 'content'>[]).reverse(); // Reverse to get chronological order
}

/**
 * Full chronological transcript of one conversation (staff detail page +
 * authenticated chat history restore). Scoped by clinic_id so a guessed
 * conversation id from another tenant returns nothing.
 */
export async function listMessagesForConversation(
  conversationId: string,
  clinicId: string
): Promise<Array<Pick<Message, 'id' | 'role' | 'content' | 'created_at'>>> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<Pick<Message, 'id' | 'role' | 'content' | 'created_at'>>;
}

export async function receivePatientMessage(params: {
  clinicId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  text: string;
}) {
  // The orchestrator handles persisting the user message and generating the AI response.
  const messages = await handleIncomingMessage({
    clinicId: params.clinicId,
    conversationId: params.conversationId || null,
    sessionId: params.sessionId || null,
    userId: params.userId || null,
    text: params.text,
  });
  
  return messages || { userMessage: null, assistantMessage: null };
}
