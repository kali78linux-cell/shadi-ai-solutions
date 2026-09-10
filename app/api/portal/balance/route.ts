import { NextResponse } from 'next/server';
import {
  authorizePatientRequest,
  getOwnBalance,
  PatientPortalError,
} from '@/lib/services/patientPortal';

export const dynamic = 'force-dynamic';

/** GET /api/portal/balance — own derived balance (outstanding + credit). */
export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    const balance = await getOwnBalance(auth.identity);
    return NextResponse.json({ balance: balance ?? { outstanding: 0, credit: 0, invoiced_total: 0, paid_total: 0, written_off_total: 0 } });
  } catch {
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}
