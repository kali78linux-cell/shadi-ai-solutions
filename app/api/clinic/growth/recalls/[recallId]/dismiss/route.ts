import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { dismissRecall } from '@/lib/services/growth';

export async function POST(req: Request, context: { params: { recallId: string } }) {
  try {
    const body = await req.json();
    const clinicId = body?.clinic_id;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, DATA_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    await dismissRecall({ clinicId, recallId: context.params.recallId, actorUserId: authorization.user?.id ?? null });
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}