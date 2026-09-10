import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { updateRecallRule, deleteRecallRule } from '@/lib/services/growth';

export async function PATCH(req: Request, context: { params: { ruleId: string } }) {
  try {
    const body = await req.json();
    const clinicId = body?.clinic_id;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const patch: { recallAfterDays?: number; enabled?: boolean } = {};
    if (body.recall_after_days !== undefined) {
      const n = Number(body.recall_after_days);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        return NextResponse.json({ error: 'recall_after_days must be an integer between 1 and 3650' }, { status: 400 });
      }
      patch.recallAfterDays = n;
    }
    if (body.enabled !== undefined) patch.enabled = body.enabled === true;

    const data = await updateRecallRule({
      clinicId,
      ruleId: context.params.ruleId,
      ...patch,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: { params: { ruleId: string } }) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    await deleteRecallRule({ clinicId, ruleId: context.params.ruleId });
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}