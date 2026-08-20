import { supabaseAdmin } from '@/lib/supabase/admin';
import { Conversation } from '@/types/db';
import { ANALYTICS_EVENTS, recordAnalyticsEvent } from './conversationIntelligence';

export async function createConversation(params: { clinic_id: string; patient_id?: string | null; session_id?: string | null; metadata?: Record<string, unknown> }) {
  const { data, error } = await supabaseAdmin.from('conversations').insert([
    {
      clinic_id: params.clinic_id,
      patient_id: params.patient_id || null,
      session_id: params.session_id || `sess:${Date.now()}`,
      metadata: params.metadata || {},
    },
  ]).select('*').single();
  if (error) throw error;
  await recordAnalyticsEvent(supabaseAdmin, { clinicId: params.clinic_id, conversationId: data.id, type: ANALYTICS_EVENTS.conversationStarted });
  return data as Conversation;
}

export async function getConversationById(id: string, clinicId?: string) {
  let query = supabaseAdmin.from('conversations').select('*').eq('id', id).limit(1);
  if (clinicId) query = query.eq('clinic_id', clinicId);
  const { data, error } = await query.single();
  if (error) throw error;
  return data as Conversation;
}

export async function listConversationsForClinic(clinicId: string, limit = 50) {
  const { data, error } = await supabaseAdmin.from('conversations').select('*').eq('clinic_id', clinicId).limit(limit).order('started_at', { ascending: false });
  if (error) throw error;
  return data as Conversation[];
}

export async function updateConversationStatus(id: string, status: 'open' | 'awaiting_human' | 'closed') {
  const { data, error } = await supabaseAdmin.from('conversations').update({ status }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Conversation;
}

export async function updateConversationState(id: string, state: Conversation['conversation_state'], clinicId?: string) {
  let query = supabaseAdmin.from('conversations').update({ conversation_state: state }).eq('id', id);
  if (clinicId) query = query.eq('clinic_id', clinicId);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  await recordAnalyticsEvent(supabaseAdmin, { clinicId: data.clinic_id, conversationId: data.id, type: ANALYTICS_EVENTS.conversationStateChanged, payload: { state } });
  return data as Conversation;
}
