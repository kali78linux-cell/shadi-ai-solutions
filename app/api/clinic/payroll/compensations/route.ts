import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { listCompensations, createCompensation, type CompensationModel } from '@/lib/services/payroll';

// Payroll Foundation — compensation CONFIGURATION only (D-P1). No salary or
// commission calculation happens here; this is effective-dated configuration
// with exactly one ACTIVE config per provider (DB-enforced).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (!body?.provider_id) return NextResponse.json({ error: 'provider_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await createCompensation({
      clinicId: body.clinic_id,
      providerId: body.provider_id,
      model: body.model as CompensationModel,
      commissionPercent: body.commission_percent ?? null,
      fixedMonthlyAmount: body.fixed_monthly_amount ?? null,
      effectiveFrom: body.effective_from,
      notes: body.notes ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /COMPENSATION_MODEL_FIELDS_MISMATCH/.test(message)
      ? 400
      : /duplicate key|unique constraint/i.test(message)
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_READ_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const data = await listCompensations(
      clinicId,
      url.searchParams.get('provider_id') ?? undefined,
      url.searchParams.get('include_ended') === 'true',
    );
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
