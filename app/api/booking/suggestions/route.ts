import { NextResponse } from 'next/server';
import { z } from 'zod';
import { suggestBookingSlots } from '@/lib/services/smartScheduling';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 2 — Intelligent slot suggestions (public, availability-aware).
 * Only REAL provider schedules + REAL service durations + REAL appointments
 * produce slots; ranking is deterministic (earlier + gap-fill + preferred
 * window). No availability is ever invented.
 */
export const runtime = 'nodejs';

const schema = z.object({
  clinic_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  service_id: z.string().uuid().optional(),
  provider_id: z.string().uuid().optional(),
  preferred_window: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
  buffer_minutes: z.coerce.number().int().min(0).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(10).optional().default(5),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = schema.safeParse({
      clinic_id: url.searchParams.get('clinic_id'),
      date: url.searchParams.get('date'),
      service_id: url.searchParams.get('service_id') ?? undefined,
      provider_id: url.searchParams.get('provider_id') ?? undefined,
      preferred_window: url.searchParams.get('preferred_window') ?? undefined,
      buffer_minutes: url.searchParams.get('buffer_minutes') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request parameters', details: parsed.error.errors }, { status: 400 });
    }

    const result = await suggestBookingSlots({
      clinicId: parsed.data.clinic_id,
      date: parsed.data.date,
      serviceId: parsed.data.service_id ?? null,
      providerId: parsed.data.provider_id ?? null,
      preferredWindow: parsed.data.preferred_window ?? null,
      bufferMinutes: parsed.data.buffer_minutes ?? 0,
      limit: parsed.data.limit,
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_suggestions_error', { error: message }, 'error');
    if (message.includes('not found for this clinic')) {
      return NextResponse.json({ error: 'Not found for this clinic' }, { status: 404 });
    }
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}