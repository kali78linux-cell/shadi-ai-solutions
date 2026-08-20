import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { getClinicCommunicationSettings, saveClinicCommunicationSettings, validateAndNormalizeSettings } from '@/lib/communications/settings';
import { logEvent } from '@/lib/server/logging';

const settingsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  reminderChannels: z.array(z.enum(['email', 'sms', 'whatsapp', 'telegram'])).optional(),
  confirmationChannels: z.array(z.enum(['email', 'sms', 'whatsapp', 'telegram'])).optional(),
  cancellationChannels: z.array(z.enum(['email', 'sms', 'whatsapp', 'telegram'])).optional(),
  defaultChannel: z.enum(['email', 'sms', 'whatsapp', 'telegram']).optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const settings = await getClinicCommunicationSettings(clinicId);
    return NextResponse.json({ data: settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('communication_settings_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid settings payload', details: parsed.error.errors }, { status: 400 });
    }

    // Force clinic_id from the authenticated caller — never from the body.
    const normalized = validateAndNormalizeSettings(clinicId, parsed.data);
    const saved = await saveClinicCommunicationSettings(normalized);

    logEvent('communication_settings_updated', { clinic_id: clinicId });
    return NextResponse.json({ data: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('communication_settings_put_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}