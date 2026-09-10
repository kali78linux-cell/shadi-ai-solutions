import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { createMedicalUploadIntent, resolveMedicalFileOrgAccess } from '@/lib/services/medicalFiles';
import { logEvent } from '@/lib/server/logging';

/**
 * MEDICAL FILE SIGNED-UPLOAD START.
 * POST /api/clinic/medical-files/upload-start  { clinic_id, patient_id,
 *   imaging_request_id?, filename, mime_type, size_bytes, magic? }
 *
 * Returns a short-lived presigned PUT URL. The browser/device then streams the
 * binary DIRECTLY to Supabase Storage (never buffered in the Next.js process),
 * which is what makes large CBCT/DICOM studies practical. Server-side policy
 * (MIME/ext/size/magic) is enforced here before any URL is issued.
 */
export const runtime = 'nodejs';

const schema = z.object({
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  imaging_request_id: z.string().uuid().nullable().optional(),
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(120),
  size_bytes: z.number().int().positive(),
  magic: z.string().max(64).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, patient_id, imaging_request_id, filename, mime_type, size_bytes, magic } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية رفع ملفات طبية' }, { status: 403 });

    const access = await resolveMedicalFileOrgAccess(clinic_id, patient_id, imaging_request_id ?? null);
    if (!access.ok || !('patient' in access)) {
      return NextResponse.json({ error: 'message' in access ? access.message : 'غير مصرح' }, { status: 403 });
    }

    const intent = await createMedicalUploadIntent({
      clinicId: clinic_id,
      patientClinicId: access.patient.clinic_id,
      patientId: patient_id,
      imagingRequestId: imaging_request_id ?? null,
      appointmentId: null,
      filename,
      mimeType: mime_type,
      sizeBytes: size_bytes,
      magicHex: magic ?? null,
      uploadedBy: auth.user?.id ?? null,
    });
    if (!intent.ok || 'message' in intent) return NextResponse.json({ error: 'message' in intent ? intent.message : 'فشل تجهيز الرفع' }, { status: 400 });

    logEvent('medical_file_upload_started', { clinic_id, patient_id, request_id: imaging_request_id });
    return NextResponse.json({
      data: {
        storage_path: intent.storagePath,
        upload_url: intent.uploadUrl,
        token: intent.token,
        file_type: intent.fileType,
        max_bytes: intent.maxBytes,
      },
    });
  } catch (err) {
    logEvent('medical_files_upload_start_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}