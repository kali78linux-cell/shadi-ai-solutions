import { NextResponse } from 'next/server';
import { supabaseClient } from '@/lib/supabase/client';
import { logEvent } from '@/lib/server/logging';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { getConversationById } from '@/lib/services/conversationService';
import { saveMessage } from '@/lib/services/messageService';

async function getUserFromToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

/**
 * PHASE M — staff reply inside a patient conversation.
 * The transcript already renders role='staff' bubbles; this is the ONLY
 * write path that creates them (canonical — no duplicate reply endpoints).
 * Auth: bearer token + clinic membership via authorizeClinicRequest, and the
 * conversation must belong to that clinic (tenant isolation).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { conversation_id: conversationId, content } = body ?? {};
    if (!conversationId || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'conversation_id and content are required' }, { status: 400 });
    }
    if (content.length > 4096) {
      return NextResponse.json({ error: 'الرسالة طويلة جدًا (الحد 4096 حرفًا)' }, { status: 400 });
    }

    const user = await getUserFromToken(req);
    if (!user) {
      logEvent('authentication_failure', { route: 'ai_conversations_reply', reason: 'missing_user' }, 'warn');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const authorization = await authorizeClinicRequest(req, conversation.clinic_id);
    if (!authorization.authorized) {
      logEvent('authorization_denied', {
        route: 'ai_conversations_reply',
        clinic_id: conversation.clinic_id,
        user_id: user.id,
        reason: authorization.status === 401 ? 'unauthorized' : 'forbidden',
      }, 'warn');
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const message = await saveMessage({
      conversation_id: conversationId,
      clinic_id: conversation.clinic_id,
      role: 'staff',
      sender_id: user.id,
      content: content.trim(),
    });
    logEvent('staff_reply_sent', { clinic_id: conversation.clinic_id, conversation_id: conversationId });
    return NextResponse.json({ data: message }, { status: 201 });
  } catch (err: any) {
    logEvent('ai_conversations_reply_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}