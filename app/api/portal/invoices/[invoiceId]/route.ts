import { NextResponse } from 'next/server';
import {
  authorizePatientRequest,
  getOwnInvoice,
  PatientPortalError,
} from '@/lib/services/patientPortal';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/portal/invoices/[invoiceId] — own invoice detail (fail-closed). */
export async function GET(
  req: Request,
  { params }: { params: { invoiceId: string } }
) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  const invoiceId = params?.invoiceId ?? '';
  if (!UUID_RE.test(invoiceId)) {
    // manipulated/invalid id → indistinguishable from not-owned
    return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 });
  }
  try {
    const invoice = await getOwnInvoice(auth.identity, invoiceId);
    if (!invoice) return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ invoice });
  } catch {
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}
