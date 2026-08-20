import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const scheduleRowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'start_time must be HH:MM'),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'end_time must be HH:MM'),
  appointment_duration_minutes: z.number().int().min(5).max(480).optional(),
  max_appointments_per_day: z.number().int().min(1).max(500).optional().nullable(),
});

const schedulePutSchema = z.object({ schedule: z.array(scheduleRowSchema).max(7) });

export async function GET(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const providerId = pathname.split('/').filter(Boolean).pop();
    const clinicId = searchParams.get('clinic_id');
    if (!providerId) return NextResponse.json({ error: 'provider_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { data: provider, error: providerError } = await supabase.from('providers').select('id').eq('id', providerId).eq('clinic_id', clinicId).single();
    if (providerError || !provider) return NextResponse.json({ error: 'Provider not found for this clinic' }, { status: 404 });

    const { data, error } = await supabase.from('provider_schedules').select('*').eq('clinic_id', clinicId).eq('provider_id', providerId).order('weekday', { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('provider_schedule_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const providerId = pathname.split('/').filter(Boolean).pop();
    const clinicId = searchParams.get('clinic_id');
    if (!providerId) return NextResponse.json({ error: 'provider_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = schedulePutSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid schedule payload', details: parsed.error.errors }, { status: 400 });

    for (const row of parsed.data.schedule) {
      if (row.enabled && row.end_time <= row.start_time) {
        return NextResponse.json({ error: `end_time must be after start_time on weekday ${row.weekday}` }, { status: 400 });
      }
    }

    const supabase = supabaseAdmin;
    const { data: provider, error: providerError } = await supabase.from('providers').select('id').eq('id', providerId).eq('clinic_id', clinicId).single();
    if (providerError || !provider) return NextResponse.json({ error: 'Provider not found for this clinic' }, { status: 404 });

    const rows = parsed.data.schedule.map((row) => ({
      clinic_id: clinicId,
      provider_id: providerId,
      weekday: row.weekday,
      enabled: row.enabled,
      start_time: row.start_time,
      end_time: row.end_time,
      breaks: [],
      appointment_duration_minutes: row.appointment_duration_minutes ?? 30,
      max_appointments_per_day: row.max_appointments_per_day ?? null,
    }));

    const { error: upsertError } = await supabase.from('provider_schedules').upsert(rows, { onConflict: 'provider_id,weekday' });
    if (upsertError) throw new Error(upsertError.message);

    logEvent('provider_schedule_updated', { clinic_id: clinicId, provider_id: providerId });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('provider_schedule_put_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}