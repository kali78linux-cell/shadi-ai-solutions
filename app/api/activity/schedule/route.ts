import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { scheduleActivityRequest } from '@/lib/services/smartScheduling';
import { workflowErrorResponse } from '@/lib/services/workflowService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 2 — Activity-aware scheduling (imaging_center / dental_lab).
 * Books an imaging request / lab case into a REAL provider slot, driven by the
 * real availability pipeline (ActivitySchedulingResult) and, for imaging, the
 * PHASE 1B machine (requested→scheduled, audited). No invented availability.
 */
export const runtime = 'nodejs';

const schema = z.object({
  clinic_id: z.string().uuid(),
  entity_type: z.enum(['imaging_requests', 'lab_cases']),
  request_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration_minutes: z.coerce.number().int().positive().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الجدولة' }, { status: 403 });

    const result = await scheduleActivityRequest({
      clinicId: clinic_id,
      entityType: parsed.data.entity_type,
      requestId: parsed.data.request_id,
      providerId: parsed.data.provider_id,
      date: parsed.data.date,
      time: parsed.data.time,
      durationMinutes: parsed.data.duration_minutes,
      actorUserId: auth.user?.id ?? null,
      actorRole: auth.role ?? null,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const workflowRes = workflowErrorResponse(err);
    if (workflowRes) return workflowRes;
    const message = err instanceof Error ? err.message : String(err);
    logEvent('activity_schedule_error', { error: message }, 'error');
    if (message.includes('entity_not_found')) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (message.includes('slot_unavailable')) return NextResponse.json({ error: `Slot unavailable: ${message.split(':').pop()}` }, { status: 409 });
    if (message.includes('no_schedule_configured')) return NextResponse.json({ error: 'No provider schedule configured for this slot' }, { status: 409 });
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}