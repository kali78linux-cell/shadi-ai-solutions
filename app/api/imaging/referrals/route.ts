import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, DATA_ROLES, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';

/**
 * CROSS-TENANT IMAGING REFERRALS.
 *
 * A dental clinic (referring_org) creates an imaging_request owned by an
 * independent imaging center (target). Authorized ONLY when:
 *   1) the caller is a member of the referring clinic (clinic_id),
 *   2) the patient belongs to that referring clinic,
 *   3) an ACCEPTED relationship exists between the two organizations
 *      (either direction), and
 *   4) the target is an imaging_center activity.
 *
 * The imaging center never sees the full patient file — only the fields the
 * scenario requires (name/reference + the request). This is why we carry
 * patient_ref as the display reference alongside patient_id.
 */
export const runtime = 'nodejs';

const createSchema = z.object({
  clinic_id: z.string().uuid(), // referring organization
  target_imaging_center_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  service_id: z.string().uuid().nullable().optional(), // structured link → clinic_services
  referring_provider_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['routine', 'urgent']).optional().default('routine'),
  requested_service: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id: referringClinicId, target_imaging_center_id: targetId, patient_id: patientId } = parsed.data;

    const auth = await authorizeClinicRequest(req, referringClinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // 2) patient belongs to the referring clinic.
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('id, clinic_id, full_name')
      .eq('id', patientId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!patient) return NextResponse.json({ error: 'المريض غير موجود' }, { status: 404 });
    if (patient.clinic_id !== referringClinicId) {
      return NextResponse.json({ error: 'المريض لا ينتمي لهذه العيادة' }, { status: 403 });
    }

    // 3) accepted relationship (either direction).
    const { data: rel } = await supabaseAdmin
      .from('organization_relationships')
      .select('id, status')
      .or(`and(source_org_id.eq.${referringClinicId},target_org_id.eq.${targetId}),and(source_org_id.eq.${targetId},target_org_id.eq.${referringClinicId})`)
      .eq('status', 'accepted')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (!rel) {
      return NextResponse.json({ error: 'لا توجد علاقة مقبولة مع مركز التصوير' }, { status: 403 });
    }

    // 3b) service_id must belong to the REFERRING clinic's own catalog (the
    // billable service is the imaging center's, mirrored in its clinic_services).
    const serviceId = parsed.data.service_id ?? null;
    if (serviceId) {
      const { data: svc } = await supabaseAdmin
        .from('clinic_services')
        .select('id, clinic_id')
        .eq('id', serviceId)
        .is('deleted_at', null)
        .maybeSingle();
      if (!svc || svc.clinic_id !== targetId) {
        return NextResponse.json({ error: 'الخدمة المطلوبة غير معرفة لدى مركز التصوير' }, { status: 400 });
      }
    }

    // 4) target is an imaging center.
    const { data: target } = await supabaseAdmin
      .from('clinics')
      .select('id, activity_type')
      .eq('id', targetId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!target || target.activity_type !== 'imaging_center') {
      return NextResponse.json({ error: 'الجهة المستهدفة ليست مركز تصوير' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('imaging_requests')
      .insert({
        clinic_id: targetId,
        referring_clinic_id: referringClinicId,
        patient_id: patientId,
        patient_ref: patient.full_name,
        service_id: serviceId,
        referring_provider_id: parsed.data.referring_provider_id ?? null,
        requested_service: parsed.data.requested_service ?? null,
        notes: parsed.data.notes ?? null,
        priority: parsed.data.priority,
        status: 'submitted',
        created_at: new Date().toISOString(),
      })
      .select('id, patient_ref, requested_service, status, notes, created_at')
      .single();
    if (error) throw new Error(error.message);
    logEvent('imaging_referral_created', {
      referring_clinic_id: referringClinicId,
      imaging_center_id: targetId,
      patient_id: patientId,
      request_id: data.id,
      priority: parsed.data.priority,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    logEvent('imaging_referral_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

/** List referrals SENT BY this clinic (referring-side view). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from('imaging_requests')
      .select('id, clinic_id, referring_clinic_id, patient_id, requested_service, status, notes, created_at')
      .eq('referring_clinic_id', clinicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    logEvent('imaging_referral_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}