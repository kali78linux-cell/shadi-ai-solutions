import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { logEvent } from '@/lib/server/logging';

const clinicSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  slug: z.string().min(1).max(200).optional(),
}).refine((data) => data.clinic_id || data.slug, {
  message: 'Either clinic_id or slug is required',
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = clinicSchema.safeParse({
      clinic_id: url.searchParams.get('clinic_id') ?? undefined,
      slug: url.searchParams.get('slug') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request parameters', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, slug } = parsed.data;

    // Resolve the clinic. Never falls back to a fake/default clinic.
    const clinic = await resolvePublicClinic({ id: clinic_id, slug });

    if (!clinic) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
    }

    return NextResponse.json({ data: clinic });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_clinic_resolution_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}