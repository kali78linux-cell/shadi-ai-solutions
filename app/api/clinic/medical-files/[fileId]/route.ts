import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { signMedicalFileUrl, deleteMedicalFileById } from '@/lib/services/medicalFiles';
import { logEvent } from '@/lib/server/logging';

/** GET → short-lived signed URL (never a public URL). DELETE → soft-delete + storage. */
export const runtime = 'nodejs';

async function assertAccess(clinicId: string, fileId: string) {
  const { data: file } = await supabaseAdmin
    .from('medical_files')
    .select('id, clinic_id, patient_id, imaging_request_id, storage_path, deleted_at')
    .eq('id', fileId)
    .maybeSingle();
  if (!file || file.deleted_at) return { ok: false as const, message: 'الملف غير موجود' };

  if (file.clinic_id === clinicId) return { ok: true as const, file };

  // Partner org: only when an imaging request ties this org to the file.
  if (file.imaging_request_id) {
    const { data: req } = await supabaseAdmin
      .from('imaging_requests')
      .select('id')
      .eq('id', file.imaging_request_id)
      .or(`clinic_id.eq.${clinicId},referring_clinic_id.eq.${clinicId}`)
      .is('deleted_at', null)
      .maybeSingle();
    if (req) return { ok: true as const, file };
  }
  return { ok: false as const, message: 'لا تملك صلاحية على هذا الملف' };
}

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const access = await assertAccess(clinicId, params.fileId);
    if (!access.ok) return NextResponse.json({ error: access.message }, { status: 403 });

    const signedUrl = await signMedicalFileUrl(access.file.storage_path);
    logEvent('medical_file_signed', { clinic_id: clinicId, file_id: params.fileId });
    return NextResponse.json({ data: { id: access.file.id, signed_url: signedUrl } });
  } catch (err) {
    logEvent('medical_file_signed_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { fileId: string } }) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const access = await assertAccess(clinicId, params.fileId);
    if (!access.ok) return NextResponse.json({ error: access.message }, { status: 403 });
    if (access.file.clinic_id !== clinicId) {
      return NextResponse.json({ error: 'لا يمكن حذف ملفات مسجّلة من جهة أخرى' }, { status: 403 });
    }

    const result = await deleteMedicalFileById(clinicId, params.fileId);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    logEvent('medical_file_delete_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}