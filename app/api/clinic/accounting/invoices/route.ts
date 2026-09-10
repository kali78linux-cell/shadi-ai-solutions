import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, INVOICE_CREATE_ROLES, FINANCE_READ_ROLES, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { issueInvoice, listInvoices } from '@/lib/services/accounting';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, INVOICE_CREATE_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const { patient_id, appointment_id, items, discount, tax, notes, due_at, payer_type, payer_ref } = body;
    // D-B3 — Discount authorization: any commercial discount on issuance
    // requires FINANCE_ADMIN (owner/accountant). No hard-coded limits.
    if ((discount ?? 0) > 0) {
      const moneyDenied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
      if (moneyDenied) {
        return NextResponse.json({ error: 'DISCOUNT_AUTHORIZATION_REQUIRED' }, { status: moneyDenied.status });
      }
    }
    const result = await issueInvoice({
      clinicId: body.clinic_id,
      patientId: patient_id,
      appointmentId: appointment_id ?? null,
      items: Array.isArray(items) ? items : [],
      discount: discount ?? 0,
      tax: tax ?? 0,
      notes: notes ?? null,
      dueAt: due_at ?? null,
      payerType: payer_type ?? null,
      payerRef: payer_ref ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /INVOICE_ITEMS_REQUIRED|ITEM_DESCRIPTION_REQUIRED|INVALID_QUANTITY|INVALID_UNIT_PRICE|INVOICE_TOTAL_NEGATIVE|ITEM_PRICE_INVALID|DISCOUNT_INVALID|TAX_INVALID|INVALID_PAYER_TYPE|PROVIDER_NOT_FOUND/.test(message) ? 400 : 500;
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
    const data = await listInvoices(clinicId, url.searchParams.get('patient_id'));
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}