import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { matchWaitlistForReleasedSlot } from '@/lib/services/growth';

/**
 * POST /api/clinic/growth/waitlist/match
 * On-demand matching when a slot is released (appointment cancelled).
 * Callers are internal flows; guarded by FINANCE_ADMIN (owner/accountant) to
 * avoid abuse — matching consumes patient communication budget.
 * Idempotent: a released appointment yields at most one offer (DB unique index).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    if (!body.appointment_id || !body.released_at || !body.provider_id) {
      return NextResponse.json({ error: 'appointment_id, provider_id, released_at required' }, { status: 400 });
    }

    const entry = await matchWaitlistForReleasedSlot({
      clinicId: body.clinic_id,
      appointmentId: body.appointment_id,
      providerId: body.provider_id,
      serviceId: body.service_id ?? null,
      releasedAt: body.released_at,
      durationMinutes: body.duration_minutes ?? null,
    });
    return NextResponse.json({ data: { matched: entry !== null, entry } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}