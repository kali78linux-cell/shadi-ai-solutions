import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { confirmMedicalUpload, resolveMedicalFileOrgAccess } from '@/lib/services/medicalFiles';
import { logEvent } from '@/lib/server/logging';

/**
 * MEDICAL FILE UPLOAD CONFIRM.
 * POST /api/clinic/medical-files/confirm  { clinic_id, patient_id,
 *   imaging_request_id?, storage_path, mime_type, size_bytes, filename, file_type }
 *
 * Verifies the object actually exists in storage (never trusts the client),
 * writes the authoritative metadata row, and marks the upload session
 * confirmed. On any failure the orphan object is removed (recovery).
 */
export const runtime = 'nodejs';

const MEDICAL_FILE_TYPES = ['image', 'video', 'pdf', 'document', 'medical_report', 'medical_image'] as const;

const schema = z.object({
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  imaging_request_id: z.string().uuid().nullable().optional(),
  storage_path: z.string().min(1).max(512),
  mime_type: z.string().min(1).max(120),
  size_bytes: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  file_type: z.enum(MEDICAL_FILE_TYPES),
  magic: z.string().max(64).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, patient_id, imaging_request_id, storage_path, mime_type, size_bytes, filename, file_type, magic } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية رفع ملفات طبية' }, { status: 403 });

    const access = await resolveMedicalFileOrgAccess(clinic_id, patient_id, imaging_request_id ?? null);
    if (!access.ok || !('patient' in access)) {
      return NextResponse.json({ error: 'message' in access ? access.message : 'غير مصرح' }, { status: 403 });
    }

    // The recorded upload session must exist for this clinic/path — proves THIS
    // org started the upload (IDOR guard against confirming an arbitrary path).
    const session = await getUploadSession(clinic_id, storage_path);
    if (!session.data) {
      return NextResponse.json({ error: 'لم يُعثر على جلسة رفع لهذه العيادة — ابدأ الرفع عبر upload-start' }, { status: 403 });
    }

    const result = await confirmMedicalUpload({
      clinicId: clinic_id,
      patientClinicId: access.patient.clinic_id,
      patientId: patient_id,
      imagingRequestId: imaging_request_id ?? null,
      appointmentId: null,
      storagePath: storage_path,
      token: null,
      mimeType: mime_type,
      sizeBytes: size_bytes,
      originalFilename: filename,
      fileType: file_type,
      uploadedBy: auth.user?.id ?? null,
      magicHex: magic ?? null,
    });
    if (!result.ok || 'message' in result) return NextResponse.json({ error: 'message' in result ? result.message : 'فشل حفظ الملف' }, { status: 400 });

    logEvent('medical_file_uploaded', { clinic_id, patient_id, request_id: imaging_request_id, file_id: result.item.id });
    return NextResponse.json({ data: result.item }, { status: 201 });
  } catch (err) {
    logEvent('medical_files_upload_confirm_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

async function getUploadSession(clinicId: string, storagePath: string) {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  return supabaseAdmin
    .from('medical_upload_sessions')
    .select('id, status')
    .eq('clinic_id', clinicId)
    .eq('storage_path', storagePath)
    .is('status', 'started')
    .maybeSingle();
}