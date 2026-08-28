import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/**
 * Aggregated dashboard overview — replaces the old overview page's direct
 * /api/appointments + /api/leads calls which failed with 400 because they
 * were sent WITHOUT clinic_id/auth. This endpoint is clinic-scoped by a real
 * membership and returns HONEST zeros/empty lists when there is no data;
 * "no data" is never presented as an error.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'يرجى تسجيل الدخول.' : 'لا تملك صلاحية عرض بيانات هذه العيادة.' },
        { status: authorization.status }
      );
    }

    const supabase = supabaseAdmin;

    const [patientsRes, appointmentsRes, conversationsRes] = await Promise.all([
      supabase.from('patients').select('id').eq('clinic_id', clinicId).is('deleted_at', null),
      supabase
        .from('appointments')
        .select('id, appointment_date, scheduled_at, status, patient_id, service_id, provider_id')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .order('appointment_date', { ascending: true }),
      supabase
        .from('conversations')
        .select('id, status, started_at, metadata')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .gte('started_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    if (patientsRes.error || appointmentsRes.error || conversationsRes.error) {
      throw new Error(patientsRes.error?.message || appointmentsRes.error?.message || conversationsRes.error?.message || 'overview query failed');
    }

    type ApptRow = {
      id: string;
      appointment_date: string | null;
      scheduled_at: string | null;
      status: string | null;
      patient_id: string | null;
      service_id: string | null;
      provider_id: string | null;
    };
    const appointments = (appointmentsRes.data ?? []) as ApptRow[];

    // Today in the clinic timezone (fallback Asia/Jerusalem).
    let todayIso: string;
    try {
      todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    } catch {
      todayIso = new Date().toISOString().slice(0, 10);
    }

    const isCancelled = (s: string | null) => s === 'cancelled';
    const activeAppointments = appointments.filter((a) => !isCancelled(a.status));
    const todays = activeAppointments.filter((a) => a.appointment_date === todayIso);
    const upcoming = activeAppointments
      .filter((a) => a.appointment_date && a.appointment_date > todayIso)
      .slice(0, 5);

    // Human-readable names where present — single batched lookups, no N+1.
    const patientIds = Array.from(new Set(appointments.map((a) => a.patient_id).filter(Boolean))) as string[];
    const patientsMap = new Map<string, string>();
    if (patientIds.length > 0) {
      const { data: pRows } = await supabase.from('patients').select('id, full_name').in('id', patientIds);
      for (const p of pRows ?? []) patientsMap.set(p.id, (p as { full_name?: string }).full_name ?? '');
    }
    const decorate = (list: ApptRow[]) =>
      list.map((a) => ({
        id: a.id,
        date: a.appointment_date,
        time: a.scheduled_at ? a.scheduled_at.slice(11, 16) : null,
        status: a.status,
        patient_name: (a.patient_id && patientsMap.get(a.patient_id)) || null,
      }));

    const conversations = conversationsRes.data ?? [];
    const needsAttention = conversations.filter((c) => c.status === 'awaiting_human');

    logEvent('clinic_overview_loaded', { clinic_id: clinicId });
    return NextResponse.json({
      data: {
        patients_count: patientsRes.count ?? patientsRes.data?.length ?? 0,
        today_appointments: decorate(todays),
        upcoming_appointments: decorate(upcoming),
        appointments_count: appointments.length,
        new_conversations_count: conversations.length,
        needs_attention_count: needsAttention.length,
        generated_for_day: todayIso,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_overview_error', { error: message }, 'error');
    return NextResponse.json({ error: 'تعذر تحميل بيانات لوحة التحكم. حاول مرة أخرى.' }, { status: 500 });
  }
}
