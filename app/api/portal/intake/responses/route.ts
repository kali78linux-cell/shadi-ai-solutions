import { NextResponse } from 'next/server';
import { authorizePatientRequest, PatientPortalError } from '@/lib/services/patientPortal';
import { listOwnIntakeResponses } from '@/lib/services/intakeService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 4 — Portal: the patient's OWN intake submissions (identity-derived).
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
    const responses = await listOwnIntakeResponses(auth.identity);
    return NextResponse.json({ data: responses });
  } catch (err) {
    logEvent('portal_intake_responses_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}