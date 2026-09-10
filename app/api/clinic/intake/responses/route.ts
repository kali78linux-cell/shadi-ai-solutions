import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { listIntakeResponses } from '@/lib/services/intakeService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 4 — Intake responses (staff, tenant-scoped).
 * GET: submissions for the clinic, optionally filtered by form/patient.
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const formId = url.searchParams.get('form_id') ?? null;
    const patientId = url.searchParams.get('patient_id') ?? null;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const responses = await listIntakeResponses({ clinicId, formId, patientId });
    return NextResponse.json({ data: responses });
  } catch (err) {
    logEvent('intake_responses_list_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}