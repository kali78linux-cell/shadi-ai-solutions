import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { addWaitlistEntry, listWaitlistEntries } from '@/lib/services/growth';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, DATA_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const data = await listWaitlistEntries(clinicId, url.searchParams.get('status') ?? undefined);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (!isUuid(body.patient_id)) return NextResponse.json({ error: 'patient_id required' }, { status: 400 });
    if (!body.expires_at || Number.isNaN(new Date(body.expires_at).getTime())) {
      return NextResponse.json({ error: 'expires_at required (ISO date)' }, { status: 400 });
    }
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, DATA_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await addWaitlistEntry({
      clinicId: body.clinic_id,
      patientId: body.patient_id,
      providerId: body.provider_id ?? null,
      serviceId: body.service_id ?? null,
      preferredFrom: body.preferred_from ?? null,
      preferredTo: body.preferred_to ?? null,
      priority: Number.isInteger(body.priority) ? body.priority : 0,
      expiresAt: body.expires_at,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found|foreign key|violates/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}