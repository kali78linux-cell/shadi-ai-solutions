import { NextResponse } from 'next/server';
import { authorizePatientRequest, PatientPortalError } from '@/lib/services/patientPortal';

export const dynamic = 'force-dynamic';

/** GET /api/portal/identity — resolve the session's patient identity. */
export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  return NextResponse.json({
    identity: {
      clinic_id: auth.identity.clinic_id,
      patient_id: auth.identity.patient_id,
      email: auth.identity.email,
    },
  });
}
