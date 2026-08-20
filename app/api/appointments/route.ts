import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { getCalendarRange } from '@/lib/services/scheduling';
import { getSupabaseEnvConfig } from '@/lib/config';
import { createDemoAppointment, getDemoAppointments } from '@/lib/demoState';

const createAppointmentSchema = z.object({
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid().optional().nullable(),
  service: z.string().min(1),
  appointment_date: z.string().min(1),
  duration_minutes: z.coerce.number().int().min(15).max(480).default(30),
  provider_id: z.string().uuid().optional().nullable(),
  status: z.enum(['scheduled', 'confirmed', 'pending', 'cancelled']).optional().default('scheduled'),
});

const updateAppointmentSchema = z.object({
  status: z.enum(['scheduled', 'confirmed', 'pending', 'cancelled', 'completed', 'no_show']).optional(),
  provider_id: z.string().uuid().optional().nullable(),
  appointment_date: z.string().min(1).optional(),
  scheduled_at: z.string().optional(),
});

async function getUserFromToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

async function enrichAppointments(clinicId: string, rows: any[]) {
  if (!rows || rows.length === 0) return [];

  // Collect unique patient and provider IDs
  const patientIds = Array.from(new Set(rows.map((r) => r.patient_id).filter(Boolean)));
  const providerIds = Array.from(new Set(rows.map((r) => r.provider_id).filter(Boolean)));

  // Load patient names
  let patientMap: Record<string, string> = {};
  if (patientIds.length > 0) {
    const { data: patients } = await supabaseAdmin
      .from('patients')
      .select('id, full_name')
      .in('id', patientIds);
    patientMap = Object.fromEntries((patients ?? []).map((p) => [p.id, p.full_name]));
  }

  // Load provider names
  let providerMap: Record<string, string> = {};
  if (providerIds.length > 0) {
    const { data: providers } = await supabaseAdmin
      .from('providers')
      .select('id, name')
      .in('id', providerIds);
    providerMap = Object.fromEntries((providers ?? []).map((p) => [p.id, p.name]));
  }

  return rows.map((row) => ({
    ...row,
    patient_name: patientMap[row.patient_id] ?? 'Unknown patient',
    provider_name: providerMap[row.provider_id] ?? null,
    appointment_time: row.scheduled_at ? new Date(row.scheduled_at).toISOString().slice(11, 16) : '09:00',
  }));
}

export async function GET(req: Request) {
  try {
    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      const appointments = getDemoAppointments().map((appointment) => ({
        ...appointment,
        patient_name: 'مريض تجريبي',
        appointment_time: appointment.appointment_time ?? '09:00',
      }));
      return NextResponse.json({ data: appointments });
    }

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
    let query = supabaseAdmin
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

    const enriched = await enrichAppointments(clinicId, data ?? []);
    return NextResponse.json({ data: enriched });
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

    const config = getSupabaseEnvConfig();
    if (!config.isConfigured) {
      const created = createDemoAppointment({
        clinic_id: parsed.data.clinic_id,
        patient_id: parsed.data.patient_id ?? null,
        service: parsed.data.service,
        appointment_date: parsed.data.appointment_date,
        appointment_time: parsed.data.appointment_date ? '09:00' : '09:00',
        duration_minutes: parsed.data.duration_minutes,
        provider_id: parsed.data.provider_id ?? null,
        status: parsed.data.status,
      });
      return NextResponse.json({ data: { ...created, patient_name: 'مريض تجريبي', appointment_time: created.appointment_time ?? '09:00' } }, { status: 201 });
    }

    const { clinic_id, patient_id, service, appointment_date, duration_minutes, provider_id, status } = parsed.data;
    const authorization = await authorizeClinicRequest(req, clinic_id);
    if (!authorization.authorized) {
      logEvent('authorization_denied', { route: 'appointments_post', clinic_id, reason: authorization.status === 401 ? 'unauthorized' : 'forbidden' }, 'warn');
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const { data, error } = await supabaseAdmin.from('appointments').insert([
      { clinic_id, patient_id, service, appointment_date, duration_minutes, provider_id, status },
    ]).select('*').single();
    if (error) {
      logEvent('appointment_create_failure', { clinic_id, patient_id: patient_id || undefined, provider_id: provider_id || undefined, error: error.message }, 'error');
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const enriched = await enrichAppointments(clinic_id, [data]);
    return NextResponse.json({ data: enriched[0] }, { status: 201 });
  } catch (err: any) {
    logEvent('appointments_route_error', { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, 'error');
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    const appointmentId = url.searchParams.get('appointment_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (!appointmentId) return NextResponse.json({ error: 'appointment_id required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = updateAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid appointment update', details: parsed.error.errors }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .update(parsed.data)
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .select('*')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const enriched = await enrichAppointments(clinicId, [data]);
    logEvent('appointment_updated', { clinic_id: clinicId, appointment_id: appointmentId });
    return NextResponse.json({ data: enriched[0] });
  } catch (err: any) {
    logEvent('appointments_patch_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}