import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { getCalendarRange } from '@/lib/services/scheduling';

const createAppointmentSchema = z.object({
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid().optional().nullable(),
  service: z.string().min(1),
  appointment_date: z.string().min(1),
  duration_minutes: z.coerce.number().int().min(15).max(480).default(30),
  provider_id: z.string().uuid().optional().nullable(),
});

async function getUserFromToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      logEvent('authorization_denied', { route: 'appointments_get', clinic_id: clinicId, reason: authorization.status === 401 ? 'unauthorized' : 'forbidden' }, 'warn');
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const view = url.searchParams.get('view') as 'day' | 'week' | 'month' | null;
    const date = url.searchParams.get('date');
    const status = url.searchParams.get('status');
    const providerId = url.searchParams.get('provider_id');
    let query = supabase
      .from('appointments')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('scheduled_at', { ascending: true })
      .limit(100);
    if (view && date) {
      const range = getCalendarRange(date, view);
      query = query.gte('scheduled_at', range.start).lt('scheduled_at', range.end);
    }
    if (status) query = query.eq('status', status);
    if (providerId) query = query.eq('provider_id', providerId);
    const { data, error } = await query;
    if (error) {
      logEvent('appointment_query_failure', { clinic_id: clinicId, error: error.message }, 'error');
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (err: any) {
    logEvent('appointments_route_error', { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, 'error');
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = createAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      logEvent('appointment_validation_error', { error: parsed.error.errors }, 'warn');
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, patient_id, service, appointment_date, duration_minutes, provider_id } = parsed.data;
    const authorization = await authorizeClinicRequest(req, clinic_id);
    if (!authorization.authorized) {
      logEvent('authorization_denied', { route: 'appointments_post', clinic_id, reason: authorization.status === 401 ? 'unauthorized' : 'forbidden' }, 'warn');
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const { data, error } = await supabase.from('appointments').insert([
      { clinic_id, patient_id, service, appointment_date, duration_minutes, provider_id, status: 'scheduled' },
    ]).select('*').single();
    if (error) {
      logEvent('appointment_create_failure', { clinic_id, patient_id: patient_id || undefined, provider_id: provider_id || undefined, error: error.message }, 'error');
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    logEvent('appointments_route_error', { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, 'error');
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

