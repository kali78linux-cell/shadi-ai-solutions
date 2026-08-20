import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RateLimiter } from '@/lib/services/gateway/security/rate-limiter';
import { receivePatientMessage } from '@/lib/services/messageService';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { createConversation, getConversationById } from '@/lib/services/conversationService';
import { streamAndRecordResponse } from '@/lib/ai/streamingOrchestrator';
import { getProviderHealth } from '@/lib/ai/provider';
import { getSupabaseEnvConfig } from '@/lib/config';
import { appendDemoMessage, createDemoConversation, getDemoMessages } from '@/lib/demoState';

const MAX_MESSAGE_LENGTH = 4096;
const limiter = new RateLimiter(20, 60 * 1000); // 20 requests per minute

const messageSchema = z.object({
  clinic_id: z.string().uuid(),
  conversation_id: z.string().min(1).max(256).optional().nullable(),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  stream: z.boolean().optional().default(false),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get('conversation_id');
    const clinicId = url.searchParams.get('clinic_id');
    if (!conversationId || !clinicId) {
      return NextResponse.json({ error: 'conversation_id and clinic_id are required' }, { status: 400 });
    }

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      return NextResponse.json({ data: getDemoMessages(conversationId) });
    }

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    return NextResponse.json({ data: [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load history' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      const conv = createDemoConversation({ clinic_id: parsed.data.clinic_id, session_id: `demo:${Date.now()}` });
      const userMessage = appendDemoMessage({ conversation_id: conv.id, clinic_id: parsed.data.clinic_id, role: 'patient', content: parsed.data.text });
      const assistantMessage = appendDemoMessage({ conversation_id: conv.id, clinic_id: parsed.data.clinic_id, role: 'assistant', content: 'AI runtime is not configured. Please configure an AI provider (OpenAI, Anthropic, or Ollama) in the environment.' });
      return NextResponse.json({ conversation_id: conv.id, user_message: userMessage, assistant_message: assistantMessage, error: 'AI runtime is not configured. Please configure an AI provider.' }, { status: 503 });
    }

    const authorization = await authorizeClinicRequest(req, parsed.data.clinic_id);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    if (!limiter.isAllowed(authorization.user.id)) { // Correctly activate the rate limiter
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Provider-agnostic health check: works for OpenAI, Anthropic, or Ollama
    const health = getProviderHealth();
    if (!health.configured) {
      return NextResponse.json({ error: 'AI runtime is not configured. Please configure an AI provider.' }, { status: 503 });
    }

    let convId = parsed.data.conversation_id || null;
    if (convId) {
      // Verify the conversation belongs to the authenticated clinic (IDOR protection)
      const conversation = await getConversationById(convId, parsed.data.clinic_id);
      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
      }
    } else {
      const conv = await createConversation({ clinic_id: parsed.data.clinic_id, metadata: { created_by: authorization.user.id } });
      convId = conv.id;
    }

    // Handle streaming vs. non-streaming requests
    if (parsed.data.stream) {
      try {
        // streamAndRecordResponse returns a StreamingTextResponse or a regular Response for handoff
        return await streamAndRecordResponse({
          clinicId: parsed.data.clinic_id,
          conversationId: convId,
          userId: authorization.user.id,
          text: parsed.data.text,
        });
      } catch (error) {
        console.error('[Streaming API Error]', error);
        return NextResponse.json({ error: 'An error occurred during the streaming request.' }, { status: 500 });
      }
    } else {
      // Fallback to the original synchronous flow
      const { userMessage, assistantMessage } = await receivePatientMessage({
        clinicId: parsed.data.clinic_id,
        conversationId: convId,
        userId: authorization.user.id,
        text: parsed.data.text,
      });

      return NextResponse.json({ conversation_id: convId, user_message: userMessage, assistant_message: assistantMessage });
    }
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('AI runtime is not configured')) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}