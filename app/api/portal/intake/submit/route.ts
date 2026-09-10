import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizePatientRequest, PatientPortalError } from '@/lib/services/patientPortal';
import { submitIntakeResponse } from '@/lib/services/intakeService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 4 — Portal: submit an intake response.
 * Identity-derived clinic/patient (never client-trusted). Answers validated
 * server-side against the form schema; optional appointment link verified to
 * belong to the patient; e-consent recorded when required + affirmatively given.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const submitSchema = z.object({
  form_id: z.string().uuid(),
  answers: z.record(z.unknown()),
  appointment_id: z.string().uuid().optional().nullable(),
  consent: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    const body = await req.json().catch(() => null);
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }

    const result = await submitIntakeResponse({
      identity: auth.identity,
      formId: parsed.data.form_id,
      answers: parsed.data.answers,
      appointmentId: parsed.data.appointment_id ?? null,
      consent: parsed.data.consent,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('portal_intake_submit_error', { error: message }, 'error');
    if (message === 'INTAKE_FORM_NOT_FOUND') {
      return NextResponse.json({ error: 'INTAKE_FORM_NOT_FOUND' }, { status: 404 });
    }
    if (message === 'INTAKE_VALIDATION_FAILED') {
      return NextResponse.json(
        { error: 'INTAKE_VALIDATION_FAILED', details: (err as any).details ?? [] },
        { status: 400 }
      );
    }
    if (message === 'APPOINTMENT_NOT_FOUND_FOR_PATIENT') {
      return NextResponse.json({ error: 'APPOINTMENT_NOT_FOUND_FOR_PATIENT' }, { status: 404 });
    }
    return NextResponse.json({ error: 'PORTAL_SUBMIT_FAILED' }, { status: 500 });
  }
}