import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { updateCompensation } from '@/lib/services/payroll';

// Compensation config lifecycle (status='ended' / effective dates) — never
// deleted (DB guard enforces immutability of the configuration history).
export async function PATCH(req: Request, { params }: { params: Promise<{ compensationId: string }> }) {
  try {
    const { compensationId } = await params;
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await updateCompensation({
      clinicId: body.clinic_id,
      compensationId,
      status: body.status,
      effectiveTo: body.effective_to,
      commissionPercent: body.commission_percent,
      fixedMonthlyAmount: body.fixed_monthly_amount,
      notes: body.notes,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
