import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAvailableSlots } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

const availabilitySchema = z.object({
  clinic_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  service_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = availabilitySchema.safeParse({
      clinic_id: url.searchParams.get('clinic_id'),
      provider_id: url.searchParams.get('provider_id'),
      date: url.searchParams.get('date'),
      service_id: url.searchParams.get('service_id') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request parameters', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, provider_id, date, service_id, limit } = parsed.data;

    const slots = await getAvailableSlots(clinic_id, provider_id, date, limit, service_id);

    return NextResponse.json({ data: { clinic_id, provider_id, date, service_id: service_id ?? null, slots } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_availability_error', { error: message }, 'error');
    if (message.includes('Provider not found')) {
      return NextResponse.json({ error: 'Provider not found for this clinic' }, { status: 404 });
    }
    if (message.includes('Provider is not assigned to this service')) {
      return NextResponse.json({ error: 'Provider is not assigned to this service' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}