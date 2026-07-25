import { supabase } from '@/lib/supabase';
import { handleIncomingMessage } from '@/lib/ai/orchestrator';

export async function saveMessage(payload: {
  conversation_id: string | null;
  clinic_id: string;
  role: 'patient' | 'assistant' | 'staff' | 'system';
  sender_id?: string | null;
  content?: string | null;
  content_json?: Record<string, unknown> | null;
}) {
  const { data, error } = await supabase.from('messages').insert([payload]).select('*').single();
  if (error) throw error;
  return data;
}

export async function receivePatientMessage(params: {
  clinicId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  text: string;
}) {
  // Persist incoming message and orchestrate AI response
  const msg = await saveMessage({ conversation_id: params.conversationId || null, clinic_id: params.clinicId, role: 'patient', sender_id: params.userId || null, content: params.text });

  const assistant = await handleIncomingMessage({
    clinicId: params.clinicId,
    conversationId: params.conversationId || null,
    sessionId: params.sessionId || null,
    userId: params.userId || null,
    text: params.text,
  });

  return { userMessage: msg, assistantMessage: assistant };
}
