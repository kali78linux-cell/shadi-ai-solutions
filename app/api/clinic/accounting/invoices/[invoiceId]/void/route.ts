import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { voidInvoice } from '@/lib/services/accounting';

export async function POST(req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    const { invoiceId } = await params;
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const body = await req.json();
    await voidInvoice({ clinicId, invoiceId, reason: body?.reason ?? '', actorUserId: authorization.user?.id ?? null });
    return NextResponse.json({ data: { voided: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /VOID_REASON_REQUIRED|INVOICE_NOT_FOUND|INVOICE_ALREADY_VOIDED|VOID_PAYMENTS_FIRST/.test(message) ? (message === 'INVOICE_NOT_FOUND' ? 404 : 400) : 500;
    return NextResponse.json({ error: message }, { status });
  }
}