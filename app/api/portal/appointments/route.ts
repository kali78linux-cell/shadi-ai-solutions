import { NextResponse } from 'next/server';
import {
  authorizePatientRequest,
  listOwnAppointments,
  PatientPortalError,
} from '@/lib/services/patientPortal';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/appointments — own appointments only.
 * clinic_id/patient_id are derived server-side from the session identity;
 * client-supplied identifiers are ignored by design.
 */
export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    const appointments = await listOwnAppointments(auth.identity);
    return NextResponse.json({ appointments });
  } catch (err) {
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}
