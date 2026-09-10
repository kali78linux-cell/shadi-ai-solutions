import { NextResponse } from 'next/server';
import { authorizePatientRequest, PatientPortalError } from '@/lib/services/patientPortal';
import { listActiveFormsForPatient } from '@/lib/services/intakeService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 4 — Portal: active intake forms for the patient's own clinic.
 * clinic_id derived server-side from the session identity.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    const forms = await listActiveFormsForPatient(auth.identity);
    return NextResponse.json({ data: forms });
  } catch (err) {
    logEvent('portal_intake_forms_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}