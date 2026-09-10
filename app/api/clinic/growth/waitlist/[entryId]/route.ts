import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { cancelWaitlistEntry, updateWaitlistEntry } from '@/lib/services/growth';

const VALID_STATUSES = ['active', 'notified', 'booked', 'expired', 'cancelled'];

export async function PATCH(req: Request, context: { params: { entryId: string } }) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, DATA_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const patch: {
      providerId?: string | null;
      serviceId?: string | null;
      preferredFrom?: string | null;
      preferredTo?: string | null;
      priority?: number;
      expiresAt?: string;
      status?: 'active' | 'notified' | 'booked' | 'expired' | 'cancelled';
    } = {};
    if (body.provider_id !== undefined) patch.providerId = body.provider_id;
    if (body.service_id !== undefined) patch.serviceId = body.service_id;
    if (body.preferred_from !== undefined) patch.preferredFrom = body.preferred_from;
    if (body.preferred_to !== undefined) patch.preferredTo = body.preferred_to;
    if (body.priority !== undefined) {
      const p = Number(body.priority);
      if (!Number.isInteger(p) || p < 0 || p > 100) return NextResponse.json({ error: 'priority must be integer 0-100' }, { status: 400 });
      patch.priority = p;
    }
    if (body.expires_at !== undefined) {
      if (Number.isNaN(new Date(body.expires_at).getTime())) return NextResponse.json({ error: 'expires_at invalid' }, { status: 400 });
      patch.expiresAt = body.expires_at;
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) return NextResponse.json({ error: 'status invalid' }, { status: 400 });
      patch.status = body.status;
    }

    const data = await updateWaitlistEntry({
      clinicId: body.clinic_id,
      entryId: context.params.entryId,
      patch,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: { params: { entryId: string } }) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, DATA_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    await cancelWaitlistEntry({ clinicId, entryId: context.params.entryId, actorUserId: authorization.user?.id ?? null });
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}