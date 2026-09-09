import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import {
  getConversations,
  getAcceptedPartners,
  sendMessage,
  assertCanMessage,
} from '@/lib/services/clinicMessaging';

/**
 * PHASE H — Clinic-to-Clinic Messaging System.
 *
 * GET → list accepted partner conversations + last message per conversation
 * POST → send a message (file upload + patient info) to an accepted partner
 * PUT → mark all messages in a conversation as read
 */

export const runtime = 'nodejs';

// Query param: ?clinic_id=UUID  (the viewing tenant)
function resolveClinicId(req: Request): string {
  const url = new URL(req.url);
  return url.searchParams.get('clinic_id') ?? '';
}

// POST body schema — file_url is a STORAGE PATH (clinic/{id}/messaging/...),
// validated server-side again in sendMessage (tenant-folder ownership).
const postSchema = z.object({
  to_clinic_id: z.string().uuid(),
  content: z.string().max(5000).optional().nullable(),
  file_url: z.string().min(1).max(1024).optional().nullable(),
  file_name: z.string().max(255).optional().nullable(),
  file_size: z.number().int().positive().optional().nullable(),
  patient_name: z.string().max(200).optional().nullable(),
  patient_phone: z.string().max(40).optional().nullable(),
  patient_notes: z.string().max(2000).optional().nullable(),
});

export async function GET(req: Request) {
  try {
    const clinicId = resolveClinicId(req);
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

    const conversations = await getConversations(clinicId);
    const partners = await getAcceptedPartners(clinicId);
    return NextResponse.json({ data: conversations, partners });
  } catch (err) {
    logEvent('messaging_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const clinicId = resolveClinicId(req);
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });
    }

    // Enforce: only accepted partners can message
    const guard = await assertCanMessage(clinicId, parsed.data.to_clinic_id);
    if ('message' in guard) {
      return NextResponse.json({ error: guard.message }, { status: guard.status });
    }

    const message = await sendMessage(clinicId, parsed.data.to_clinic_id, {
      content: parsed.data.content,
      file_url: parsed.data.file_url,
      file_name: parsed.data.file_name,
      file_size: parsed.data.file_size,
      patient_name: parsed.data.patient_name,
      patient_phone: parsed.data.patient_phone,
      patient_notes: parsed.data.patient_notes,
    });

    logEvent('messaging_message_sent', {
      from_clinic_id: clinicId,
      to_clinic_id: parsed.data.to_clinic_id,
      has_file: !!parsed.data.file_url,
    });

    return NextResponse.json({ data: message }, { status: 201 });
  } catch (err) {
    logEvent('messaging_post_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
