import { NextResponse } from 'next/server';
import {
  authorizePatientRequest,
  listOwnPayments,
  PatientPortalError,
} from '@/lib/services/patientPortal';

export const dynamic = 'force-dynamic';

/** GET /api/portal/payments — own payment history (patient-safe projection). */
export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    return NextResponse.json({ payments: await listOwnPayments(auth.identity) });
  } catch {
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}
