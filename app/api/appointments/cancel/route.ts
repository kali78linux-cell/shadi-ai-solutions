import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { matchWaitlistAfterCancellation } from '@/lib/services/waitlistService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 2 — Staff cancellation with rules + waitlist matching.
 * Only owner/manager can cancel (RBAC). After a successful cancellation, active
 * waitlist entries matching the freed slot are notified (best-effort).
 */
export const runtime = 'nodejs';

const cancelSchema = z.object({
  clinic_id: z.string().uuid(),
  appointment_id: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, appointment_id } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإلغاء' }, { status: 403 });

    // Load the appointment (tenant-scoped) to know the freed slot.
    const { data: appointment, error: loadError } = await supabaseAdmin
      .from('appointments')
      .select('id, provider_id, service_id, scheduled_at, status')
      .eq('id', appointment_id)
      .eq('clinic_id', clinic_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });

    const INELIGIBLE = new Set(['cancelled', 'completed', 'no_show']);
    if (INELIGIBLE.has(appointment.status)) {
      return NextResponse.json({ error: `Appointment cannot be cancelled from status: ${appointment.status}` }, { status: 409 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointment_id)
      .eq('clinic_id', clinic_id)
      .is('deleted_at', null);
    if (updateError) throw new Error(updateError.message);

    // Free the cancelled slot for waitlist patients (best-effort).
    const scheduledAt = appointment.scheduled_at as string | null;
    await matchWaitlistAfterCancellation({
      clinicId: clinic_id,
      providerId: (appointment as any).provider_id ?? null,
      serviceId: (appointment as any).service_id ?? null,
      cancelledDate: scheduledAt ? scheduledAt.slice(0, 10) : null,
      cancelledTime: scheduledAt ? scheduledAt.slice(11, 16) : null,
    });

    logEvent('appointment_cancelled_staff', { clinic_id: clinic_id, appointment_id });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    logEvent('appointment_cancel_staff_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}