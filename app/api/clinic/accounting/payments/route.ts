import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, PAYMENT_RECORD_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { recordPayment, listPayments } from '@/lib/services/accounting';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, PAYMENT_RECORD_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const { invoice_id, amount, method, reference, idempotency_key, payer_type, payer_ref } = body;
    // record_payment expects a real invoice UUID — reject anything else early
    // with a clear message instead of a cryptic Postgres uuid syntax error.
    if (!invoice_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(invoice_id))) {
      return NextResponse.json({ error: 'invoice_id must be a valid invoice UUID' }, { status: 400 });
    }
    const result = await recordPayment({
      clinicId: body.clinic_id,
      invoiceId: invoice_id,
      amount: amount,
      method: method,
      reference: reference ?? null,
      idempotencyKey: idempotency_key ?? null,
      payerType: payer_type ?? null,
      payerRef: payer_ref ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /INVALID_AMOUNT|INVALID_METHOD|INVOICE_NOT_FOUND|INVOICE_VOIDED|INVALID_PAYER_TYPE/.test(message) ? 400 : 500;
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
    const data = await listPayments(clinicId);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}