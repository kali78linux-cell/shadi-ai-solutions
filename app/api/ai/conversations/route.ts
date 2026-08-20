import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { createConversation, getConversationById, listConversationsForClinic, updateConversationStatus } from '@/lib/services/conversationService';
import { getSupabaseEnvConfig } from '@/lib/config';
import { createDemoConversation, getDemoConversations } from '@/lib/demoState';

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
    const { clinic_id, patient_id, session_id, metadata } = body;
    if (!clinic_id) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      const conv = createDemoConversation({ clinic_id, patient_id, session_id, metadata });
      return NextResponse.json({ data: conv }, { status: 201 });
    }

    const user = await getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // membership check
    const { data: member } = await supabase.from('clinic_users').select('role').eq('clinic_id', clinic_id).eq('user_id', user.id).limit(1).single();
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const conv = await createConversation({ clinic_id, patient_id, session_id, metadata });
    return NextResponse.json({ data: conv }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const clinicId = url.searchParams.get('clinic_id');

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      if (id) {
        const conv = getDemoConversations().find((item) => item.id === id);
        return NextResponse.json({ data: conv ?? null });
      }
      if (clinicId) {
        return NextResponse.json({ data: getDemoConversations().filter((item) => item.clinic_id === clinicId) });
      }
    }

    if (id) {
      const conv = await getConversationById(id);
      const authorization = await authorizeClinicRequest(req, conv.clinic_id);
      if (!authorization.authorized) {
        logEvent('authorization_denied', { route: 'ai_conversations_get', clinic_id: conv.clinic_id, reason: authorization.status === 401 ? 'unauthorized' : 'forbidden' }, 'warn');
        return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
      }
      return NextResponse.json({ data: conv });
    }
    if (clinicId) {
      const authorization = await authorizeClinicRequest(req, clinicId);
      if (!authorization.authorized) {
        logEvent('authorization_denied', { route: 'ai_conversations_get', clinic_id: clinicId, reason: authorization.status === 401 ? 'unauthorized' : 'forbidden' }, 'warn');
        return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
      }
      const list = await listConversationsForClinic(clinicId);
      return NextResponse.json({ data: list });
    }
    return NextResponse.json({ error: 'id or clinic_id required' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });
    if (!['open', 'awaiting_human', 'closed'].includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      return NextResponse.json({ data: { id, status } });
    }

    const user = await getUserFromToken(req);
    if (!user) {
      logEvent('authentication_failure', { route: 'ai_conversations_patch', reason: 'missing_user' }, 'warn');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const conversation = await getConversationById(id);
    const authorization = await authorizeClinicRequest(req, conversation.clinic_id);
    if (!authorization.authorized) {
      logEvent('authorization_denied', { route: 'ai_conversations_patch', clinic_id: conversation.clinic_id, user_id: user.id, reason: authorization.status === 401 ? 'unauthorized' : 'forbidden' }, 'warn');
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const updated = await updateConversationStatus(id, status as any);
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    logEvent('ai_conversations_route_error', { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, 'error');
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
