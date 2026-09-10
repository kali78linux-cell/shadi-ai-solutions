import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { recordWriteOff, listWriteOffs } from '@/lib/services/accounting';

// Accounting Phase B — write-offs (D-B2).
// POST = record a write-off (FINANCE_ADMIN only). GET = list (FINANCE_READ).

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const result = await recordWriteOff({
      clinicId: body.clinic_id,
      invoiceId: body.invoice_id,
      amount: body.amount,
      reason: body.reason ?? '',
      idempotencyKey: body.idempotency_key ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /WRITE_OFF_AMOUNT_INVALID|WRITE_OFF_REASON_REQUIRED|INVOICE_NOT_FOUND|INVOICE_VOIDED|NO_REMAINING_BALANCE|WRITE_OFF_EXCEEDS_BALANCE/.test(message)
      ? message === 'INVOICE_NOT_FOUND'
        ? 404
        : 400
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
    const data = await listWriteOffs(clinicId, url.searchParams.get('invoice_id'));
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}