import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, DATA_ROLES, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { uploadMedicalFile, resolveMedicalFileOrgAccess } from '@/lib/services/medicalFiles';
import { logEvent } from '@/lib/server/logging';

/**
 * MEDICAL FILES API — private patient medical files.
 * POST (multipart: clinic_id, patient_id, imaging_request_id?, file); GET list.
 * Owner clinic → its own patient files; partner org → only files tied to an
 * imaging request connecting THIS org with the patient's org.
 */
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية رفع ملفات طبية' }, { status: 403 });

    const form = await req.formData();
    const patientId = String(form.get('patient_id') ?? '');
    const imagingRequestIdRaw = form.get('imaging_request_id');
    const imagingRequestId = imagingRequestIdRaw ? String(imagingRequestIdRaw) : null;
    const file = form.get('file');
    if (!patientId) return NextResponse.json({ error: 'patient_id مطلوب' }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: 'الملف مطلوب' }, { status: 400 });

    const access = await resolveMedicalFileOrgAccess(clinicId, patientId, imagingRequestId);
    if (!access.ok || !('patient' in access)) {
      return NextResponse.json({ error: 'message' in access ? access.message : 'غير مصرح' }, { status: 403 });
    }

    const result = await uploadMedicalFile({
      clinicId,
      patientClinicId: access.patient.clinic_id,
      patientId,
      imagingRequestId,
      appointmentId: null,
      file,
      uploadedBy: auth.user?.id ?? null,
    });
    if (result.ok === false || 'message' in result) return NextResponse.json({ error: 'message' in result ? result.message : 'فشل حفظ الملف' }, { status: 400 });
    logEvent('medical_file_uploaded', { clinic_id: clinicId, patient_id: patientId, request_id: imagingRequestId });
    return NextResponse.json({ data: result.item }, { status: 201 });
  } catch (err) {
    logEvent('medical_files_upload_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const patientId = url.searchParams.get('patient_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!patientId) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const access = await resolveMedicalFileOrgAccess(clinicId, patientId, null);
    if (access.ok) {
      const { data, error } = await supabaseAdmin
        .from('medical_files')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return NextResponse.json({ data: data ?? [] });
    }

    // Partner org: only files tied to an imaging request connecting both orgs.
    const { data: reqs } = await supabaseAdmin
      .from('imaging_requests')
      .select('id')
      .or(`clinic_id.eq.${clinicId},referring_clinic_id.eq.${clinicId}`)
      .eq('patient_id', patientId)
      .is('deleted_at', null);
    const ids = (reqs ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'لا تملك صلاحية على ملفات هذا المريض' }, { status: 403 });
    }
    const { data, error } = await supabaseAdmin
      .from('medical_files')
      .select('*')
      .eq('patient_id', patientId)
      .in('imaging_request_id', ids)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    logEvent('medical_files_list_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
