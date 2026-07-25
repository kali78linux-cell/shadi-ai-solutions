import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';
import { RateLimiter } from '@/lib/services/gateway/security/rate-limiter';
import { receivePatientMessage } from '@/lib/services/messageService';
import { createConversation } from '@/lib/services/conversationService';

const MAX_MESSAGE_CHARS = 4000;
const messageSchema = z.object({
  clinic_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional().nullable(),
  session_id: z.string().optional().nullable(),
  text: z.string().min(1).max(MAX_MESSAGE_CHARS),
});
const limiter = new RateLimiter(20, 60_000);

async function getUserFromToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) {
      logEvent('ai_message_validation_error', { error: parsed.error.errors }, 'warn');
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, conversation_id, session_id, text } = parsed.data;
    const user = await getUserFromToken(req);
    if (!user) {
      logEvent('authentication_failure', { route: 'ai_messages_post', clinic_id, session_id }, 'warn');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!limiter.isAllowed(user.id)) {
      logEvent('rate_limit_exceeded', { clinic_id, user_id: user.id, session_id }, 'warn');
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { data: member } = await supabase.from('clinic_users').select('role').eq('clinic_id', clinic_id).eq('user_id', user.id).limit(1).single();
    if (!member) {
      logEvent('authorization_denied', { route: 'ai_messages_post', clinic_id, user_id: user.id, session_id, reason: 'forbidden' }, 'warn');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let convId = conversation_id || null;
    if (!convId) {
      const conv = await createConversation({ clinic_id, session_id, metadata: { created_by: user.id } });
      convId = conv.id;
    }

    const result = await receivePatientMessage({ clinicId: clinic_id, conversationId: convId, sessionId: session_id, userId: user.id, text });
    return NextResponse.json({ data: result });
  } catch (err: any) {
    logEvent('ai_messages_route_error', { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, 'error');
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
