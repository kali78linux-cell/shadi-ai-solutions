import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { computeMultiServicePlan, bookMultiService } from '@/lib/services/smartScheduling';
import { assertEntitlement, entitlementErrorResponse, releaseEntitlement } from '@/lib/subscription/entitlements';
import { findOrCreatePatient } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 2 — Multi-service booking (clinic staff; tenant-scoped).
 * POST /api/appointments/multi — plans then books a chained multi-service
 * appointment, guarded by the 15C `bookings` entitlement and the real
 * availability pipeline. Compensating cancellation on mid-chain failure.
 */
export const runtime = 'nodejs';

const multiSchema = z.object({
  clinic_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_ids: z.array(z.string().uuid()).min(1).max(6),
  buffer_minutes: z.coerce.number().int().min(0).max(60).optional().default(0),
  patient: z
    .object({
      name: z.string().min(1).max(200),
      phone: z.string().optional().nullable(),
    })
    .optional(),
  patient_id: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = multiSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, provider_id, date, service_ids, buffer_minutes } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الحجز' }, { status: 403 });

    let patientId = parsed.data.patient_id ?? null;
    if (!patientId) {
      if (!parsed.data.patient?.phone) {
        return NextResponse.json({ error: 'patient phone or patient_id is required' }, { status: 400 });
      }
      const patient = await findOrCreatePatient({
        clinicId: clinic_id,
        name: parsed.data.patient.name,
        phone: parsed.data.patient.phone,
      });
      if (!patient) {
        return NextResponse.json({ error: 'Unable to resolve patient' }, { status: 422 });
      }
      patientId = patient;
    }

    // Entitlement: each created appointment counts — a multi-service chain of N
    // services consumes N booking units, guarded atomically up front.
    try {
      await assertEntitlement(clinic_id, 'bookings', service_ids.length);
    } catch (err) {
      const entRes = entitlementErrorResponse(err);
      if (entRes) return entRes;
      throw err;
    }

    try {
      const result = await bookMultiService({
        clinicId: clinic_id,
        providerId: provider_id,
        date,
        patientId,
        serviceIds: service_ids,
        bufferMinutes: buffer_minutes,
        conversationId: null,
      });
      return NextResponse.json({ data: result }, { status: 201 });
    } catch (err) {
      // Compensating release — the multi-service handler already cancelled
      // partial appointments; free the entitlement units back.
      await releaseEntitlement(clinic_id, 'bookings', service_ids.length);
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('multi_booking_error', { error: message }, 'error');
    if (message.includes('not feasible')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}