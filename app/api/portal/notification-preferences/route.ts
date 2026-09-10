import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizePatientRequest, PatientPortalError } from '@/lib/services/patientPortal';
import {
  getPatientNotificationPreferences,
  upsertPatientNotificationPreferences,
} from '@/lib/services/recallService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 3 — Portal: patient manages their OWN notification preferences
 * (channel opt-out + DND window). clinic_id/patient_id are derived
 * server-side from the session identity — client input is never trusted.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const prefsSchema = z.object({
  opt_out: z.boolean().optional(),
  channels: z.array(z.enum(['whatsapp', 'telegram', 'sms', 'email'])).min(1).max(4).optional(),
  dnd_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  dnd_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    const prefs = await getPatientNotificationPreferences(auth.identity.clinic_id, auth.identity.patient_id);
    return NextResponse.json({ data: prefs });
  } catch (err) {
    logEvent('portal_prefs_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'PORTAL_QUERY_FAILED' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    const e: PatientPortalError = auth.error;
    return NextResponse.json({ error: e.code }, { status: e.status });
  }
  try {
    const body = await req.json().catch(() => null);
    const parsed = prefsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const prefs = await upsertPatientNotificationPreferences({
      clinicId: auth.identity.clinic_id,
      patientId: auth.identity.patient_id,
      optOut: parsed.data.opt_out,
      channels: parsed.data.channels,
      dndStart: parsed.data.dnd_start ?? null,
      dndEnd: parsed.data.dnd_end ?? null,
    });
    return NextResponse.json({ data: prefs });
  } catch (err) {
    logEvent('portal_prefs_put_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'PORTAL_UPDATE_FAILED' }, { status: 500 });
  }
}