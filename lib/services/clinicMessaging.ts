import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * PHASE H — Clinic-to-Clinic Messaging service layer.
 *
 * All mutations run server-side via the service-role client AFTER
 * authorizeClinicRequest has confirmed the caller is a member of the tenant.
 * The DB trigger on `clinic_messages` enforces the accepted-partnership rule;
 * this layer also pre-validates to return human Arabic error messages.
 *
 * FILE STORAGE: `file_url` stores the STORAGE PATH (not a signed URL — signed
 * URLs expire after 1h and would break old messages). Signed URLs are resolved
 * fresh at read time in getThread.
 */

const MESSAGE_MAX_BYTES = 25 * 1024 * 1024; // 25MB — matches public media cap

const MESSAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/dicom': '.dcm',
};

const MESSAGE_ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.dcm'];

export type ConversationSummary = {
  partner_id: string;
  partner_name: string;
  partner_slug: string | null;
  partner_activity: string | null;
  last_message_id: string;
  last_content: string | null;
  last_file_name: string | null;
  last_created_at: string;
  unread_count: number;
};

export type ClinicMessage = {
  id: string;
  from_clinic_id: string;
  to_clinic_id: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_notes: string | null;
  is_read: boolean;
  created_at: string;
};

export type ThreadMessage = ClinicMessage & {
  direction: 'incoming' | 'outgoing';
};

export type MessageFileValidation =
  | { ok: true; ext: string }
  | { ok: false; message: string };

/** Messaging-specific validation: images + PDF reports + DICOM scans. */
export function validateMessageFile(file: {
  name: string;
  type: string;
  size: number;
}): MessageFileValidation {
  const lower = file.name.toLowerCase().trim();
  // Browsers send application/dicom OR an empty MIME for .dcm files.
  const ext =
    MESSAGE_MIME_EXT[file.type] ??
    (lower.endsWith('.dcm') ? '.dcm' : undefined);
  if (!ext) {
    return {
      ok: false,
      message:
        'نوع الملف غير مدعوم. المقبول: JPG / PNG / WebP / GIF (صور)، PDF (تقارير)، DICOM (أشعة)',
    };
  }
  if (file.size <= 0) return { ok: false, message: 'الملف فارغ' };
  if (file.size > MESSAGE_MAX_BYTES) {
    return {
      ok: false,
      message: `حجم الملف يتجاوز الحد الأقصى (${Math.round(MESSAGE_MAX_BYTES / 1024 / 1024)}MB)`,
    };
  }
  if (!lower.endsWith('.pdf') && !MESSAGE_ALLOWED_EXTS.some((e) => lower.endsWith(e))) {
    return { ok: false, message: 'امتداد الملف غير مدعوم' };
  }
  return { ok: true, ext };
}

/** Storage path for a message attachment — tenant-scoped, never the raw filename. */
export function buildMessageStoragePath(clinicId: string, ext: string): string {
  return `clinic/${clinicId}/messaging/${randomUUID()}${ext}`;
}

/** True when the path belongs to this tenant's messaging folder (anti cross-tenant). */
export function isOwnMessageFilePath(clinicId: string, path: string): boolean {
  return path.startsWith(`clinic/${clinicId}/messaging/`);
}

/** Validate that an accepted relationship exists before messaging. */
export async function assertCanMessage(
  fromClinicId: string,
  toClinicId: string
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  if (fromClinicId === toClinicId) {
    return { ok: false, message: 'لا يمكنك إرسال رسالة إلى نفسك', status: 400 };
  }

  const { data: rel, error } = await supabaseAdmin
    .from('organization_relationships')
    .select('id, status')
    .or(
      `and(source_org_id.eq.${fromClinicId},target_org_id.eq.${toClinicId}),` +
      `and(source_org_id.eq.${toClinicId},target_org_id.eq.${fromClinicId})`
    )
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return { ok: false, message: 'حدث خطأ في التحقق من العلاقة', status: 500 };
  if (!rel) return { ok: false, message: 'لا توجد علاقة مع هذه المؤسسة', status: 403 };
  if (rel.status !== 'accepted') {
    return {
      ok: false,
      message: `العلاقة غير مقبولة حالياً (${rel.status}). يجب قبول العلاقة أولاً.`,
      status: 403,
    };
  }
  return { ok: true };
}

/** Fetch conversation summaries (accepted partners + last message + unread count). */
export async function getConversations(clinicId: string): Promise<ConversationSummary[]> {
  const { data, error } = await supabaseAdmin.rpc('get_clinic_conversations', {
    p_clinic_id: clinicId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationSummary[];
}

export type AcceptedPartner = {
  partner_id: string;
  partner_name: string;
  partner_type: string | null;
};

/** Accepted (non-soft-deleted) partners — shown even when no conversation exists yet.

    NOTE: ANY accepted relationship type qualifies (referral_partner,
    imaging_provider, lab_provider). This mirrors the DB trigger
    `enforce_messaging_relationship` and the `get_clinic_conversations` RPC,
    which both accept any `status='accepted'` row regardless of type —
    filtering by type here would hide real partners (e.g. a clinic linked to
    an imaging center via a legacy `referral_partner` row). */
export async function getAcceptedPartners(clinicId: string): Promise<AcceptedPartner[]> {
  const { data, error } = await supabaseAdmin
    .from('organization_relationships')
    .select('source_org_id, target_org_id')
    .or(`source_org_id.eq.${clinicId},target_org_id.eq.${clinicId}`)
    .eq('status', 'accepted')
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  const rels = (data ?? []) as { source_org_id: string; target_org_id: string }[];
  const partnerIds = Array.from(
    new Set(rels.map((r) => (r.source_org_id === clinicId ? r.target_org_id : r.source_org_id)))
  );
  if (partnerIds.length === 0) return [];
  const { data: orgs, error: orgsError } = await supabaseAdmin
    .from('clinics')
    .select('id, name, activity_type')
    .in('id', partnerIds)
    .is('deleted_at', null);
  if (orgsError) throw new Error(orgsError.message);
  return ((orgs ?? []) as { id: string; name: string; activity_type: string | null }[]).map((o) => ({
    partner_id: o.id,
    partner_name: o.name,
    partner_type: o.activity_type,
  }));
}

/** Resolve fresh short-lived signed URLs for stored attachment paths. */
async function resolveSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  await Promise.all(
    unique.map(async (path) => {
      const { data, error } = await supabaseAdmin.storage
        .from('medical-files')
        .createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) resolved.set(path, data.signedUrl);
    })
  );
  return resolved;
}

/** Fetch full message thread with a specific partner (signed URLs resolved fresh). */
export async function getThread(
  clinicId: string,
  partnerId: string
): Promise<ThreadMessage[]> {
  const guard = await assertCanMessage(clinicId, partnerId);
  if ('message' in guard) throw new Error(guard.message);

  const { data, error } = await supabaseAdmin
    .from('clinic_messages')
    .select('*')
    .or(
      `and(from_clinic_id.eq.${clinicId},to_clinic_id.eq.${partnerId}),` +
      `and(from_clinic_id.eq.${partnerId},to_clinic_id.eq.${clinicId})`
    )
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClinicMessage[];

  // file_url stores a storage PATH — resolve a fresh signed URL per read.
  const signed = await resolveSignedUrls(
    rows.filter((m) => isOwnMessageFilePath(clinicId, m.file_url ?? '')).map((m) => m.file_url!)
  );

  return rows.map((m) => ({
    ...m,
    file_url:
      m.file_url && signed.has(m.file_url)
        ? signed.get(m.file_url)!
        : m.file_url && /^https?:\/\//.test(m.file_url)
          ? m.file_url // legacy absolute URLs (if any) pass through
          : null, // signing failed → degrade to name-only, never a broken link
    direction: m.from_clinic_id === clinicId ? ('outgoing' as const) : ('incoming' as const),
  }));
}

/** Upload a message attachment to the tenant-scoped messaging folder. Returns the storage PATH. */
export async function uploadMessageFile(
  clinicId: string,
  file: File
): Promise<{ ok: true; url: string; name: string; size: number } | { ok: false; message: string }> {
  const validation = validateMessageFile(file);
  if ('message' in validation) return validation;

  const path = buildMessageStoragePath(clinicId, validation.ext);

  const { error: uploadError } = await supabaseAdmin.storage
    .from('medical-files')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { ok: false, message: `خطأ في رفع الملف: ${uploadError.message}` };
  }

  // No signed URL here — getThread resolves fresh URLs at read time.
  return { ok: true, url: path, name: file.name, size: file.size };
}

/** Insert a new message into the thread. Rejects attachments outside the tenant folder. */
export async function sendMessage(
  fromClinicId: string,
  toClinicId: string,
  payload: {
    content?: string | null;
    file_url?: string | null;
    file_name?: string | null;
    file_size?: number | null;
    patient_name?: string | null;
    patient_phone?: string | null;
    patient_notes?: string | null;
  }
): Promise<ClinicMessage> {
  if (payload.file_url && !isOwnMessageFilePath(fromClinicId, payload.file_url)) {
    throw new Error('مسار الملف المرفق غير صالح لهذه المؤسسة');
  }

  const { data, error } = await supabaseAdmin
    .from('clinic_messages')
    .insert({
      from_clinic_id: fromClinicId,
      to_clinic_id: toClinicId,
      content: payload.content ?? null,
      file_url: payload.file_url ?? null,
      file_name: payload.file_name ?? null,
      file_size: payload.file_size ?? null,
      patient_name: payload.patient_name ?? null,
      patient_phone: payload.patient_phone ?? null,
      patient_notes: payload.patient_notes ?? null,
      is_read: false,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as ClinicMessage;
}

/** Mark all messages received by `clinicId` from `partnerId` as read. */
export async function markConversationRead(clinicId: string, partnerId: string) {
  const { error } = await supabaseAdmin
    .from('clinic_messages')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('to_clinic_id', clinicId)
    .eq('from_clinic_id', partnerId)
    .eq('is_read', false);

  if (error) throw new Error(error.message);
}

/** Count unread messages for a clinic (for notification badges). */
export async function countUnreadMessages(clinicId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('clinic_messages')
    .select('*', { count: 'exact', head: true })
    .eq('to_clinic_id', clinicId)
    .eq('is_read', false);

  if (error) {
    console.error('countUnreadMessages error:', error.message);
    return 0;
  }
  return count ?? 0;
}
/** Map a message-file storage path's extension to a medical file type + MIME. */
export function medicalTypeFromMessagePath(
  path: string
): { fileType: 'image' | 'pdf' | 'medical_image'; mime: string } | null {
  const lower = path.toLowerCase();
  if (/\.(jpe?g)$/.test(lower)) return { fileType: 'image', mime: 'image/jpeg' };
  if (/\.png$/.test(lower)) return { fileType: 'image', mime: 'image/png' };
  if (/\.webp$/.test(lower)) return { fileType: 'image', mime: 'image/webp' };
  if (/\.gif$/.test(lower)) return { fileType: 'image', mime: 'image/gif' };
  if (/\.pdf$/.test(lower)) return { fileType: 'pdf', mime: 'application/pdf' };
  if (/\.dcm$/.test(lower)) return { fileType: 'medical_image', mime: 'application/dicom' };
  return null;
}

/**
 * PHASE I — Attach a message attachment to a patient's medical file.
 *
 * Copies the messaging attachment (same `medical-files` bucket, under
 * clinic/{sender}/messaging/…) into a proper medical file path for that
 * patient tenant, then records the medical_files row. Both the message and
 * the target patient must belong to the requesting clinic (cross-tenant safe):
 * the attachment is only copied for the clinic that owns it (sender).
 */
export async function attachMessageToPatient(input: {
  clinicId: string;
  messageId: string;
  patientId: string;
}): Promise<{ ok: true; medicalFileId: string } | { ok: false; message: string }> {
  const { clinicId, messageId, patientId } = input;

  // 1) Load the message — must involve this clinic (sender or receiver).
  const { data: message, error: mErr } = await supabaseAdmin
    .from('clinic_messages')
    .select('id, from_clinic_id, to_clinic_id, file_url, file_name, file_size, created_at')
    .eq('id', messageId)
    .maybeSingle();
  if (mErr) return { ok: false, message: 'خطأ في جلب الرسالة' };
  if (!message) return { ok: false, message: 'الرسالة غير موجودة' };
  const party =
    message.from_clinic_id === clinicId
      ? ('sender' as const)
      : message.to_clinic_id === clinicId
        ? ('receiver' as const)
        : null;
  if (!party) return { ok: false, message: 'هذه الرسالة لا تخص مؤسستك' };
  if (!message.file_url || !/^clinic\/[^/]+\/messaging\//.test(message.file_url)) {
    return { ok: false, message: 'هذه الرسالة لا تحتوي على ملف قابل للإرفاق' };
  }

  // 2) Load the target patient — must belong to this clinic (tenant-scoped).
  const { data: patient, error: pErr } = await supabaseAdmin
    .from('patients')
    .select('id, clinic_id')
    .eq('id', patientId)
    .is('deleted_at', null)
    .maybeSingle();
  if (pErr || !patient || patient.clinic_id !== clinicId) {
    return { ok: false, message: 'المريض غير موجود في هذه المؤسسة' };
  }

  // 3) Map the file type; guard against unsupported extensions.
  const meta = medicalTypeFromMessagePath(message.file_url);
  if (!meta) return { ok: false, message: 'صيغة الملف غير مدعومة في الملفات الطبية' };

  // 4) Copy the object into the patient medical-files path (same bucket).
  const { buildMedicalFileStoragePath } = await import('@/lib/services/medicalFiles');
  const ext = message.file_url.slice(message.file_url.lastIndexOf('.'));
  const destPath = buildMedicalFileStoragePath(patient.clinic_id, patient.id, ext.startsWith('.') ? ext : `.${ext}`);
  const { error: copyErr } = await supabaseAdmin.storage
    .from('medical-files')
    .copy(message.file_url, destPath);
  if (copyErr) return { ok: false, message: `تعذر نسخ الملف إلى ملف المريض: ${copyErr.message}` };

  // 5) Record the medical_files row (authoritative metadata).
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('medical_files')
    .insert({
      clinic_id: patient.clinic_id,
      patient_id: patient.id,
      imaging_request_id: null,
      appointment_id: null,
      file_type: meta.fileType,
      mime_type: meta.mime,
      size_bytes: message.file_size ?? 0,
      storage_path: destPath,
      original_filename: message.file_name ?? 'مرفق',
      uploaded_by: null,
    })
    .select('id')
    .single();
  if (insErr) {
    // Roll back the copied object — no dangling storage.
    await supabaseAdmin.storage.from('medical-files').remove([destPath]);
    return { ok: false, message: `تعذر حفظ بيانات الملف: ${insErr.message}` };
  }

  return { ok: true, medicalFileId: inserted.id };
}