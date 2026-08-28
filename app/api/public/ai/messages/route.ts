import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { createConversation, getConversationById } from '@/lib/services/conversationService';
import { receivePatientMessage } from '@/lib/services/messageService';
import { getSupabaseEnvConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { RateLimiter, getClientId } from '@/lib/services/gateway/security/rate-limiter';
import { logEvent } from '@/lib/server/logging';
import { buildPendingBookingContext } from '@/lib/ai/bookingContextBridge';

const bodySchema = z.object({
  clinic_slug: z.string().min(1).max(200).optional(),
  clinic_id: z.string().uuid().optional(),
  conversation_id: z.string().min(1).max(256).optional().nullable(),
  text: z.string().min(1).max(4096),
  stream: z.boolean().optional().default(false),
});

// Abuse protection for a public, AI-cost-bearing endpoint. Defaults preserved
// (10 messages / minute / IP); tunable via env without code changes.
function positiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
const POST_RATE_MAX = positiveEnvInt('PUBLIC_AI_RATE_LIMIT_MAX', 10);
const POST_RATE_WINDOW_MS = positiveEnvInt('PUBLIC_AI_RATE_LIMIT_WINDOW_MS', 60_000);
const POST_RATE_WINDOW_SECONDS = Math.ceil(POST_RATE_WINDOW_MS / 1000);
const postLimiter = new RateLimiter(POST_RATE_MAX, POST_RATE_WINDOW_MS);
// History reads are cheap DB queries but still public: 30 / minute / IP.
const getLimiter = new RateLimiter(30, 60_000);

export async function POST(req: Request) {
  if (!postLimiter.isAllowed(getClientId(req))) {
    logEvent('public_ai_rate_limited', { route: 'POST /api/public/ai/messages' });
    // Honest 429: Arabic reason the frontend surfaces verbatim + standard
    // Retry-After so well-behaved clients back off instead of hammering.
    return new NextResponse(
      JSON.stringify({ error: 'لقد أرسلت رسائل كثيرة بسرعة. انتظر نحو دقيقة ثم أعد المحاولة.' }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'Retry-After': String(POST_RATE_WINDOW_SECONDS),
        },
      },
    );
  }
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
    // AI-outage fallback: the orchestrator persists a safe reply + marks handoff.
    // Never render an undefined message to the patient.
    const safeAssistant = assistantMessage ?? {
      id: '', role: 'assistant', content: 'عذراً، حدثت مشكلة مؤقتة. سيتابع فريق العيادة معك قريباً.', created_at: new Date().toISOString(),
    };
    const updatedConversation = await getConversationById(convId, clinic.id);
    const metadata = (updatedConversation as any)?.metadata ?? {};
    return NextResponse.json({
      conversation_id: convId,
      user_message: userMessage,
      assistant_message: safeAssistant,
      // STEP 7: canonical booking projection derived from one source. The UI
      // reflects only these server-verified fields (service/provider ids from
      // operating data, and slot from real availability) — never invents.
      // STEP 10C: suppress entirely once the conversation is handed off to staff.
      booking_context: buildPendingBookingContext(metadata, {
        conversationState: (updatedConversation as any)?.conversation_state ?? null,
      }),
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_ai_message_error', { error: message }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!getLimiter.isAllowed(getClientId(req))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
  }
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

    // STEP 7: also restore the canonical pending-booking projection so a reload
    // reflects the server state (reviewer UI keeps service/provider/slot/patient
    // unless the user changes them) instead of empty stale localStorage.
    const conv = await getConversationById(convId, clinic.id);
    const metadata = (conv as any)?.metadata ?? {};
    return NextResponse.json({
      data: messages ?? [],
      // STEP 10C: suppress pending-booking projection for staff-handoff conversations.
      booking_context: buildPendingBookingContext(metadata, {
        conversationState: (conv as any)?.conversation_state ?? null,
      }),
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_ai_history_error', { error: message }, 'error');
    return NextResponse.json({ error: 'تعذر تحميل سجل المحادثة. حاول مرة أخرى.' }, { status: 500 });
  }
}
