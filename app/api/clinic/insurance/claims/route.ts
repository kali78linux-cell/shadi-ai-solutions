import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { listClaims, createClaim, type ClaimStatus } from '@/lib/services/insurance';

// Insurance Foundation — claims skeleton (D-I2). POST creates a DRAFT claim
// and records the `claim_recorded` ledger event. Settlement later records
// `claim_settled` — never a cash movement, never a payment.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (!body?.patient_id || !body?.payer_id || !body?.invoice_id) {
      return NextResponse.json({ error: 'patient_id, payer_id and invoice_id required' }, { status: 400 });
    }
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await createClaim({
      clinicId: body.clinic_id,
      patientId: body.patient_id,
      payerId: body.payer_id,
      invoiceId: body.invoice_id,
      claimedAmount: Number(body.claimed_amount),
      coverageId: body.coverage_id ?? null,
      externalRef: body.external_ref ?? null,
      actorUserId: authorization.user?.id ?? null,
      idempotencyKey: body.idempotency_key ?? null,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /INVALID_CLAIM_AMOUNT|CLAIM_PATIENT_MISMATCH|CLAIM_EXCEEDS_INVOICE|PAYER_NOT_FOUND|PAYER_INACTIVE|PAYER_NOT_INSURANCE|COVERAGE_INVALID|INVOICE_NOT_FOUND|INVOICE_VOIDED/.test(message)
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
    const data = await listClaims(clinicId, {
      patientId: url.searchParams.get('patient_id') ?? undefined,
      payerId: url.searchParams.get('payer_id') ?? undefined,
      invoiceId: url.searchParams.get('invoice_id') ?? undefined,
      status: (url.searchParams.get('status') as ClaimStatus) || undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
