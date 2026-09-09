/**
 * MEDICAL FILES — PRIVATE patient medical files. Never the public bucket.
 *
 * Binaries live in Supabase Storage bucket `medical-files` (public=false →
 * zero anonymous access), keys are random UUIDs under
 * medical/{patient_clinic_id}/{patient_id}/{uuid}.{ext}, and retrieval is
 * exclusively via authenticated short-lived signed URLs. Postgres holds
 * metadata only. DICOM-ready metadata columns live in the migration.
 */
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const MEDICAL_BUCKET = 'medical-files';
export type MedicalFileType = 'image' | 'video' | 'pdf' | 'document' | 'medical_report' | 'medical_image';

const MIME_MAP: Record<string, { type: MedicalFileType; ext: string }> = {
  'image/jpeg': { type: 'image', ext: '.jpg' },
  'image/png': { type: 'image', ext: '.png' },
  'image/webp': { type: 'image', ext: '.webp' },
  'image/gif': { type: 'image', ext: '.gif' },
  'application/pdf': { type: 'pdf', ext: '.pdf' },
  'video/mp4': { type: 'video', ext: '.mp4' },
  'video/webm': { type: 'video', ext: '.webm' },
  'video/quicktime': { type: 'video', ext: '.mov' },
  'application/dicom': { type: 'medical_image', ext: '.dcm' },
  'application/octet-stream': { type: 'document', ext: '.bin' },
};
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.mp4', '.webm', '.mov', '.dcm'];

/** Per-type byte limits (medical files need large allowances for radiology).
 *  CONFIGURABLE server-side: each limit may be overridden by env var
 *  MEDICAL_MAX_<TYPE>_BYTES (e.g. MEDICAL_MAX_MEDICAL_IMAGE_BYTES=4294967296).
 *  There is deliberately NO small hardcoded ceiling in the UI — the server
 *  authoritative limits below are the real gate. */
const DEFAULT_MEDICAL_SIZE_LIMITS: Record<MedicalFileType, number> = {
  image: 50 * 1024 * 1024, // 50 MiB
  video: 1024 * 1024 * 1024, // 1 GiB (clinical video)
  pdf: 200 * 1024 * 1024, // 200 MiB (reports/archives)
  document: 50 * 1024 * 1024,
  medical_report: 200 * 1024 * 1024,
  medical_image: 2 * 1024 * 1024 * 1024, // 2 GiB (CBCT/CT/DICOM studies)
};

function resolveLimit(type: MedicalFileType): number {
  const overrides: Record<MedicalFileType, string | undefined> = {
    image: process.env.MEDICAL_MAX_IMAGE_BYTES,
    video: process.env.MEDICAL_MAX_VIDEO_BYTES,
    pdf: process.env.MEDICAL_MAX_PDF_BYTES,
    document: process.env.MEDICAL_MAX_DOCUMENT_BYTES,
    medical_report: process.env.MEDICAL_MAX_MEDICAL_REPORT_BYTES,
    medical_image: process.env.MEDICAL_MAX_MEDICAL_IMAGE_BYTES,
  };
  const v = overrides[type];
  if (v && Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
  return DEFAULT_MEDICAL_SIZE_LIMITS[type];
}

export function getMedicalSizeLimit(type: MedicalFileType): number {
  return resolveLimit(type);
}

export function getAllMedicalSizeLimits(): Record<MedicalFileType, number> {
  const out = {} as Record<MedicalFileType, number>;
  for (const k of Object.keys(DEFAULT_MEDICAL_SIZE_LIMITS) as MedicalFileType[]) {
    out[k] = resolveLimit(k);
  }
  return out;
}

export type MedicalFileInput = { name: string; type: string; size: number };

export type MedicalFileMeta = {
  id: string;
  clinic_id: string;
  patient_id: string;
  imaging_request_id: string | null;
  appointment_id: string | null;
  file_type: MedicalFileType;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  original_filename: string | null;
  uploaded_by: string | null;
  created_at: string | null;
};

/**
 * Minimal file-signature (magic bytes) detection for the common medical and
 * document types. The first up-to-16 bytes are hex-encoded by the client and
 * checked server-side as a second gate on top of MIME/extension (the MIME and
 * extension are never trusted alone). Unknown-but-allowed types (e.g. generic
 * DICOM without a fixed prefix or octet-stream) return `true` (no false block).
 */
export const MAGIC_SIGNATURES: Record<string, ReadonlyArray<{ hex: string; label: string }>> = {
  'image/jpeg': [{ hex: 'ffd8ff', label: 'JPEG' }],
  'image/png': [{ hex: '89504e470d0a1a0a', label: 'PNG' }],
  'image/webp': [{ hex: '52494646', label: 'RIFF/WEBP' }],
  'image/gif': [{ hex: '47494638', label: 'GIF' }],
  'application/pdf': [{ hex: '25504446', label: 'PDF' }],
  'video/mp4': [{ hex: '0000001866747970', label: 'MP4' }],
  'application/dicom': [{ hex: '4449434d', label: 'DICM' }],
};

/** Checks `magicHex` (up to 32 hex chars) against known signatures for a MIME.
 *  Returns true when it matches OR when there is no signature defined (no false
 *  blocking of legitimately-unknown-but-allowed medical types). */
export function magicBytesMatch(mimeType: string, magicHex: string | null | undefined): boolean {
  if (!magicHex) return true; // absent magic is not a blocker (client may not send it)
  const expected = MAGIC_SIGNATURES[mimeType];
  if (!expected || expected.length === 0) return true;
  const hex = magicHex.toLowerCase().replace(/^0x/, '');
  return expected.some((sig) => hex.startsWith(sig.hex));
}

export function validateMedicalFile(
  file: MedicalFileInput
): { ok: true; type: MedicalFileType; ext: string; maxBytes: number } | { ok: false; message: string } {
  const entry = MIME_MAP[file.type];
  if (!entry) {
    return { ok: false, message: 'نوع الملف غير مدعوم في الملفات الطبية. المقبول: JPG / PNG / WebP / GIF / PDF / MP4 / WebM / MOV / DICOM' };
  }
  if (file.size <= 0) return { ok: false, message: 'الملف فارغ' };
  const maxBytes = getMedicalSizeLimit(entry.type);
  if (file.size > maxBytes) {
    return { ok: false, message: `حجم الملف يتجاوز الحد المسموح لهذا النوع (${Math.round(maxBytes / 1024 / 1024)}MB)` };
  }
  const lower = file.name.toLowerCase().trim();
  if (!ALLOWED_EXTS.some((e) => lower.endsWith(e))) {
    return { ok: false, message: 'امتداد الملف غير مدعوم' };
  }
  return { ok: true, type: entry.type, ext: entry.ext, maxBytes };
}

/** Tenant-isolated storage path; the original filename is NEVER the key. */
export function buildMedicalFileStoragePath(patientClinicId: string, patientId: string, ext: string): string {
  return `medical/${patientClinicId}/${patientId}/${randomUUID()}${ext}`;
}

/** Short-lived authenticated signed URL (never a public URL). */
export async function signMedicalFileUrl(storagePath: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(MEDICAL_BUCKET).createSignedUrl(storagePath, seconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'تعذر إنشاء رابط مؤقت للملف');
  return data.signedUrl;
}

export async function uploadMedicalFile(input: {
  clinicId: string;
  patientClinicId: string;
  patientId: string;
  imagingRequestId: string | null;
  appointmentId: string | null;
  file: File;
  uploadedBy: string | null;
}): Promise<{ ok: true; item: MedicalFileMeta } | { ok: false; message: string }> {
  const validation = validateMedicalFile(input.file);
  if ('message' in validation) return validation;

  const path = buildMedicalFileStoragePath(input.patientClinicId, input.patientId, validation.ext);
  const { error: upError } = await supabaseAdmin.storage
    .from(MEDICAL_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (upError) return { ok: false, message: `تعذر رفع الملف إلى التخزين: ${upError.message}` };

  const { data, error } = await supabaseAdmin
    .from('medical_files')
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      imaging_request_id: input.imagingRequestId,
      appointment_id: input.appointmentId,
      file_type: validation.type,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      storage_path: path,
      original_filename: input.file.name,
      uploaded_by: input.uploadedBy,
    })
    .select('*')
    .single();
  if (error) {
    // Roll back the orphan object — no dangling storage.
    await supabaseAdmin.storage.from(MEDICAL_BUCKET).remove([path]);
    return { ok: false, message: `تعذر حفظ بيانات الملف: ${error.message}` };
  }
  return { ok: true, item: data as MedicalFileMeta };
}

export async function deleteMedicalFileById(
  clinicId: string,
  fileId: string
): Promise<{ ok: boolean; message?: string }> {
  const { data: row, error: readError } = await supabaseAdmin
    .from('medical_files')
    .select('storage_path, clinic_id')
    .eq('id', fileId)
    .is('deleted_at', null)
    .maybeSingle();
  if (readError) return { ok: false, message: readError.message };
  if (!row) return { ok: false, message: 'الملف غير موجود' };
  if (row.clinic_id !== clinicId) return { ok: false, message: 'لا تملك صلاحية على هذا الملف' };

  const { error: delError } = await supabaseAdmin
    .from('medical_files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', fileId)
    .eq('clinic_id', clinicId);
  if (delError) return { ok: false, message: delError.message };
  await supabaseAdmin.storage.from(MEDICAL_BUCKET).remove([row.storage_path]);
  return { ok: true };
}
// ----------------------------------------------------------------------------
// DIRECT-TO-OBJECT-STORAGE SIGNED UPLOAD (large-file / radiology friendly).
// The Next.js API never buffers the whole binary: it only produces a short-
// lived presigned PUT URL (createSignedUploadUrl); the browser/device streams
// the object straight to Supabase Storage. `confirm` then verifies the object
// landed and writes metadata (with orphan cleanup on failure).
// ----------------------------------------------------------------------------

export type MedicalUploadIntentInput = {
  clinicId: string;
  patientClinicId: string;
  patientId: string;
  imagingRequestId: string | null;
  appointmentId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  magicHex?: string | null;
  uploadedBy: string | null;
};

export type MedicalUploadIntent =
  | { ok: true; storagePath: string; uploadUrl: string; token: string; fileType: MedicalFileType; maxBytes: number }
  | { ok: false; message: string };

export async function createMedicalUploadIntent(input: MedicalUploadIntentInput): Promise<MedicalUploadIntent> {
  const validation = validateMedicalFile({ name: input.filename, type: input.mimeType, size: input.sizeBytes });
  if ('message' in validation) return validation;

  // Server-side magic-bytes gate: rejects a spoofed MIME/extension when a known
  // signature exists for that type, WITHOUT buffering the whole file.
  if (!magicBytesMatch(input.mimeType, input.magicHex)) {
    return { ok: false, message: 'توقيع الملف غير مطابق لنوعه المعلن (فشل التحقق من المحتوى)' };
  }

  const path = buildMedicalFileStoragePath(input.patientClinicId, input.patientId, validation.ext);
  const { data, error } = await supabaseAdmin.storage
    .from(MEDICAL_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.signedUrl || !data?.token) {
    return { ok: false, message: `تعذر فتح قناة رفع مباشرة: ${error?.message ?? 'unknown'}` };
  }

  // Record the intented upload session (for orphan reconciliation).
  await supabaseAdmin.from('medical_upload_sessions').upsert(
    {
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      imaging_request_id: input.imagingRequestId,
      storage_path: path,
      token: data.token,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      file_type: validation.type,
      original_filename: input.filename,
      status: 'started',
      created_by: input.uploadedBy,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'clinic_id,storage_path' }
  );

  return { ok: true, storagePath: path, uploadUrl: data.signedUrl, token: data.token, fileType: validation.type, maxBytes: validation.maxBytes };
}

export type MedicalUploadConfirmInput = {
  clinicId: string;
  patientClinicId: string;
  patientId: string;
  imagingRequestId: string | null;
  appointmentId: string | null;
  storagePath: string;
  token: string | null;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  fileType: MedicalFileType;
  uploadedBy: string | null;
  magicHex?: string | null;
};

export async function confirmMedicalUpload(
  input: MedicalUploadConfirmInput
): Promise<{ ok: true; item: MedicalFileMeta } | { ok: false; message: string }> {
  // 1) Validate against policy (MIME/extension/size/magic).
  const validation = validateMedicalFile({
    name: input.originalFilename,
    type: input.mimeType,
    size: input.sizeBytes,
  });
  if ('message' in validation) return validation;
  if (!magicBytesMatch(input.mimeType, input.magicHex)) {
    return { ok: false, message: 'توقيع الملف غير مطابق لنوعه المعلن' };
  }

  // 2) Confirm the object actually exists in storage (never trust the client
  //    claimed the upload happened).
  const parent = input.storagePath.slice(0, input.storagePath.lastIndexOf('/'));
  const objectName = input.storagePath.slice(input.storagePath.lastIndexOf('/') + 1);
  const { data: listed } = await supabaseAdmin.storage.from(MEDICAL_BUCKET).list(parent, { search: objectName });
  const object = (listed ?? []).find((o) => o.name === objectName);
  if (!object) {
    return { ok: false, message: 'لم يُعثر على الملف في التخزين بعد الرفع — أعد المحاولة' };
  }
  if (object.metadata?.size && Number(object.metadata.size) !== input.sizeBytes) {
    return { ok: false, message: 'حجم الملف في التخزين لا يطابق الحجم المعلن' };
  }

  // 3) Write the metadata row (authoritative).
  const { data, error } = await supabaseAdmin
    .from('medical_files')
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      imaging_request_id: input.imagingRequestId,
      appointment_id: input.appointmentId,
      file_type: input.fileType,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      uploaded_by: input.uploadedBy,
    })
    .select('*')
    .single();
  if (error) {
    // Failed-upload recovery: drop the orphan object and mark the session.
    await supabaseAdmin.storage.from(MEDICAL_BUCKET).remove([input.storagePath]);
    await supabaseAdmin.from('medical_upload_sessions').update({ status: 'orphan', finalized_at: new Date().toISOString() }).eq('storage_path', input.storagePath);
    return { ok: false, message: `تعذر حفظ بيانات الملف: ${error.message}` };
  }

  await supabaseAdmin.from('medical_upload_sessions').update({ status: 'confirmed', finalized_at: new Date().toISOString() }).eq('storage_path', input.storagePath).eq('clinic_id', input.clinicId);
  return { ok: true, item: data as MedicalFileMeta };
}
// ----------------------------------------------------------------------------
// SHARED ORGANIZATION-LEVEL ACCESS CHECK (cross-tenant safe).
// Owner clinic  → own patient files.
// Imaging/partner org → ONLY when an imaging request connects THIS org with
// the patient's org (relationship + specific patient + specific request).
// ----------------------------------------------------------------------------
export type MedicalFileOrgAccess =
  | { ok: true; patient: { id: string; clinic_id: string } }
  | { ok: false; message: string };

export async function resolveMedicalFileOrgAccess(
  clinicId: string,
  patientId: string,
  imagingRequestId: string | null
): Promise<MedicalFileOrgAccess> {
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, clinic_id')
    .eq('id', patientId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!patient) return { ok: false, message: 'المريض غير موجود' };

  if (imagingRequestId) {
    const { data: req } = await supabaseAdmin
      .from('imaging_requests')
      .select('id, clinic_id, referring_clinic_id, patient_id')
      .eq('id', imagingRequestId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!req) return { ok: false, message: 'طلب التصوير غير موجود' };
    if (req.patient_id !== patientId) return { ok: false, message: 'الطلب لا يخص هذا المريض' };
    if (req.clinic_id !== clinicId && req.referring_clinic_id !== clinicId) {
      return { ok: false, message: 'لا تملك صلاحية على هذا الطلب' };
    }
    return { ok: true, patient };
  }

  if (patient.clinic_id !== clinicId) {
    return { ok: false, message: 'لا تملك صلاحية على ملفات هذا المريض' };
  }
  return { ok: true, patient };
}
