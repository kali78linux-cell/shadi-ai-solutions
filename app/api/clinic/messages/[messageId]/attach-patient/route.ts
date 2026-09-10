import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { attachMessageToPatient } from '@/lib/services/clinicMessaging';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE I — Attach a message attachment to a patient's medical file.
 *
 * POST /api/clinic/messages/{messageId}/attach-patient
 * Body: { clinic_id, patient_id }
 *
 * Only the sending clinic (the one that owns the messaging attachment) may
 * attach it, and only to a patient of its own tenant. The file is copied into
 * the patient's medical-files folder and a medical_files row is recorded.
 */
export const runtime = 'nodejs';

const bodySchema = z.object({
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: { messageId: string } }) {
  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'بيانات غير صحيحة (clinic_id و patient_id مطلوبان)' },
        { status: 400 }
      );
    }

    const auth = await authorizeClinicRequest(req, parsed.data.clinic_id);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.status === 401 ? 'يرجى تسجيل الدخول أولاً' : 'غير مخول' },
        { status: auth.status }
      );
    }
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية إرفاق ملفات طبية' }, { status: 403 });

    const result = await attachMessageToPatient({
      clinicId: parsed.data.clinic_id,
      messageId: params.messageId,
      patientId: parsed.data.patient_id,
    });

    if ('message' in result) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    logEvent('messaging_attached_to_patient', {
      clinic_id: parsed.data.clinic_id,
      message_id: params.messageId,
      patient_id: parsed.data.patient_id,
      medical_file_id: result.medicalFileId,
    });

    return NextResponse.json({ data: { ok: true, medical_file_id: result.medicalFileId } }, { status: 201 });
  } catch (err) {
    logEvent('messaging_attach_patient_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}