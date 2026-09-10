import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { updatePatientCoverage } from '@/lib/services/insurance';

// Coverage lifecycle (status/effective dates) — never deleted (DB guard).
export async function PATCH(req: Request, { params }: { params: Promise<{ coverageId: string }> }) {
  try {
    const { coverageId } = await params;
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await updatePatientCoverage({
      clinicId: body.clinic_id,
      coverageId,
      status: body.status,
      effectiveTo: body.effective_to,
      coveragePercent: body.coverage_percent,
      memberRef: body.member_ref,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
