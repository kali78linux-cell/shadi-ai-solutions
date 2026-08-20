import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveProviders } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

const providersSchema = z.object({
  clinic_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = providersSchema.safeParse({
      clinic_id: url.searchParams.get('clinic_id'),
      service_id: url.searchParams.get('service_id') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request parameters', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, service_id } = parsed.data;
    const providers = await getActiveProviders(clinic_id, service_id);

    return NextResponse.json({ data: { clinic_id, service_id: service_id ?? null, providers } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_providers_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}