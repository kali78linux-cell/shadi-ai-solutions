import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { supabase } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const patientId = pathname.split('/').filter(Boolean).slice(-3, -2)[0];
    const clinicId = searchParams.get('clinic_id');
    const limit = Number(searchParams.get('limit') ?? '20');

    if (!patientId) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    // Verify patient belongs to this clinic
    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();

    if (patientError || !patient) {
      return NextResponse.json({ error: 'Patient not found for this clinic' }, { status: 404 });
    }

    // Load notification history for this patient
    const { data: notifications, error } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 50));

    if (error) {
      logEvent('patient_communications_error', { clinic_id: clinicId, patient_id: patientId, error: error.message }, 'error');
      return NextResponse.json({ error: 'Failed to load communication history' }, { status: 500 });
    }

    // Sanitize payloads — never expose secrets or raw provider errors
    const safe = (notifications ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      channel: n.channel,
      status: n.status,
      scheduled_for: n.scheduled_for,
      sent_at: n.sent_at,
      failed_at: n.failed_at,
      attempt_count: n.attempt_count,
      last_error: n.last_error ? n.last_error.slice(0, 200) : null,
      appointment_id: n.appointment_id,
      created_at: n.created_at,
      payload: n.payload || {},
    }));

    return NextResponse.json({ data: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('patient_communications_route_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}