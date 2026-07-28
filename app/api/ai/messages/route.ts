import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RateLimiter } from '@/lib/services/gateway/security/rate-limiter';
import { receivePatientMessage } from '@/lib/services/messageService';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { createConversation } from '@/lib/services/conversationService';
import { streamAndRecordResponse } from '@/lib/ai/streamingOrchestrator';

const MAX_MESSAGE_LENGTH = 4096;
const limiter = new RateLimiter(20, 60 * 1000); // 20 requests per minute

const messageSchema = z.object({
  clinic_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional().nullable(),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  stream: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }

    const { auth, error } = await authorizeClinicRequest(req, parsed.data.clinic_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (!limiter.isAllowed(auth.user.id)) { // Correctly activate the rate limiter
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    let convId = parsed.data.conversation_id || null;
    if (!convId) {
      const conv = await createConversation({ clinic_id: parsed.data.clinic_id, metadata: { created_by: auth.user.id } });
      convId = conv.id;
    }

    // Handle streaming vs. non-streaming requests
    if (parsed.data.stream) {
      try {
        // streamAndRecordResponse returns a StreamingTextResponse or a regular Response for handoff
        return await streamAndRecordResponse({
          clinicId: parsed.data.clinic_id,
          conversationId: convId,
          userId: auth.user.id,
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
        userId: auth.user.id,
        text: parsed.data.text,
      });

      return NextResponse.json({ user_message: userMessage, assistant_message: assistantMessage });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
