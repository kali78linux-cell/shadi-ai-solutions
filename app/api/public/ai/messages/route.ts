import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { createConversation, getConversationById } from '@/lib/services/conversationService';
import { receivePatientMessage } from '@/lib/services/messageService';
import { getSupabaseEnvConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';

const bodySchema = z.object({
  clinic_slug: z.string().min(1).max(200).optional(),
  clinic_id: z.string().uuid().optional(),
  conversation_id: z.string().min(1).max(256).optional().nullable(),
  text: z.string().min(1).max(4096),
  stream: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const parsedBody = await req.json();
    const parsed = bodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      return NextResponse.json({ error: 'AI runtime not configured' }, { status: 503 });
    }

    const { clinic_slug, clinic_id, conversation_id, text } = parsed.data;
    const clinic = await resolvePublicClinic({ id: clinic_id, slug: clinic_slug });
    if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });

    let convId = conversation_id || null;
    if (convId) {
      try {
        const conv = await getConversationById(convId, clinic.id);
        if (!conv) return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
      } catch (e) {
        return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
      }
    } else {
      const conv = await createConversation({ clinic_id: clinic.id, session_id: `public:${Date.now()}` });
      convId = conv.id;
    }

    // Non-streaming path for public chat
    const { userMessage, assistantMessage } = await receivePatientMessage({ clinicId: clinic.id, conversationId: convId, userId: null, text });
    return NextResponse.json({ conversation_id: convId, user_message: userMessage, assistant_message: assistantMessage });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const convId = url.searchParams.get('conversation_id');
    const clinicSlug = url.searchParams.get('clinic_slug');
    const clinicId = url.searchParams.get('clinic_id');
    if (!convId || (!clinicSlug && !clinicId)) {
      return NextResponse.json({ error: 'conversation_id and clinic identifier required' }, { status: 400 });
    }
    const clinic = await resolvePublicClinic({ id: clinicId ?? undefined, slug: clinicSlug ?? undefined });
    if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });

    // Verify the conversation belongs to this clinic (IDOR protection)
    try {
      const conv = await getConversationById(convId, clinic.id);
      if (!conv) return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
    } catch {
      return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
    }

    // Load real message history for this conversation
    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Failed to load conversation history' }, { status: 500 });
    }

    return NextResponse.json({ data: messages ?? [] });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
