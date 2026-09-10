import { NextResponse } from 'next/server';
import {
  authorizePatientRequest,
  getOwnStatement,
  PatientPortalError,
} from '@/lib/services/patientPortal';

export const dynamic = 'force-dynamic';

/** GET /api/portal/statement — derived statement (invoices + payments + balance). */
export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    return NextResponse.json({ statement: await getOwnStatement(auth.identity) });
  } catch {
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}
