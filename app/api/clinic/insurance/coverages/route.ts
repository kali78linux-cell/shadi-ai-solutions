import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { listPatientCoverages, createPatientCoverage } from '@/lib/services/insurance';

// Insurance Foundation — patient coverages. Configuration/data foundation
// ONLY (D-I3): no auto split, no adjudication, no deductible/co-pay engines.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (!body?.patient_id || !body?.payer_id) return NextResponse.json({ error: 'patient_id and payer_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await createPatientCoverage({
      clinicId: body.clinic_id,
      patientId: body.patient_id,
      payerId: body.payer_id,
      policyNumber: body.policy_number ?? '',
      memberRef: body.member_ref ?? null,
      coveragePercent: body.coverage_percent ?? null,
      effectiveFrom: body.effective_from,
      effectiveTo: body.effective_to ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /POLICY_NUMBER_REQUIRED/.test(message)
      ? 400
      : /foreign key|violates/i.test(message)
        ? 400
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
    const data = await listPatientCoverages(clinicId, url.searchParams.get('patient_id') ?? undefined);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
