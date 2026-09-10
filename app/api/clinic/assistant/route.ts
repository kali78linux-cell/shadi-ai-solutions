import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { runClinicAssistant } from '@/lib/services/clinicAssistant';
import { logEvent } from '@/lib/server/logging';

/**
 * AI Clinic Operating Assistant — clinic-facing, deterministic, read-only.
 * POST { clinic_id, question, patient_id?, today?, from_month?, to_month? }
 * RBAC: any clinic member may ask; financial tools are gated inside the
 * service by FINANCE_READ_ROLES (D6: data only via authorized services).
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const clinicId = typeof body.clinic_id === 'string' ? body.clinic_id.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!clinicId || !question) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }

  const auth = await authorizeClinicRequest(req, clinicId);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: auth.status });
  }

  try {
    const result = await runClinicAssistant({
      clinicId,
      role: auth.role ?? '',
      question,
      patientId: typeof body.patient_id === 'string' ? body.patient_id : null,
      today: typeof body.today === 'string' ? body.today : undefined,
      fromMonth: typeof body.from_month === 'string' ? body.from_month : undefined,
      toMonth: typeof body.to_month === 'string' ? body.to_month : undefined,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    logEvent('clinic_assistant_error', { clinicId, message });
    if (message === 'FORBIDDEN_TOOL') {
      return NextResponse.json({ error: 'FORBIDDEN_TOOL' }, { status: 403 });
    }
    if (message === 'PATIENT_ID_REQUIRED') {
      return NextResponse.json({ error: 'PATIENT_ID_REQUIRED' }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
