import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, DATA_ROLES, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { addToWaitlist, listWaitlist, cancelWaitlistEntry } from '@/lib/services/waitlistService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 2 — Waitlist admin (staff, tenant-scoped).
 * GET: list active/notified entries for the clinic.
 * POST: admin adds a patient to the waitlist.
 * PATCH: cancel a waitlist entry.
 */
export const runtime = 'nodejs';

const createSchema = z.object({
  clinic_id: z.string().uuid(),
  contact_name: z.string().min(1).max(200),
  contact_phone: z.string().min(5).max(30),
  provider_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid().optional().nullable(),
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  preferred_window: z.enum(['morning', 'afternoon', 'evening', 'any']).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const cancelSchema = z.object({
  clinic_id: z.string().uuid(),
  entry_id: z.string().uuid(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const status = url.searchParams.get('status') ?? undefined;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const entries = await listWaitlist({ clinicId, status });
    return NextResponse.json({ data: entries });
  } catch (err) {
    logEvent('waitlist_list_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإدارة' }, { status: 403 });

    const entry = await addToWaitlist({
      clinicId: clinic_id,
      contactName: parsed.data.contact_name,
      contactPhone: parsed.data.contact_phone,
      providerId: parsed.data.provider_id ?? null,
      serviceId: parsed.data.service_id ?? null,
      preferredDate: parsed.data.preferred_date ?? null,
      preferredWindow: parsed.data.preferred_window ?? null,
      notes: parsed.data.notes ?? null,
    });
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (err) {
    logEvent('waitlist_create_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, entry_id } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإدارة' }, { status: 403 });

    await cancelWaitlistEntry(clinic_id, entry_id);
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    logEvent('waitlist_cancel_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}