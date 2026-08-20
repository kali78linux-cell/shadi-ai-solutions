import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cancelPublicBooking } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

const cancelSchema = z.object({
  clinic_id: z.string().uuid(),
  appointment_id: z.string().uuid(),
  token: z.string().min(32).max(128),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = cancelSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid cancellation request', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, appointment_id, token } = parsed.data;

    const appointment = await cancelPublicBooking({
      clinicId: clinic_id,
      appointmentId: appointment_id,
      token,
    });

    logEvent('booking_cancelled', { clinic_id, appointment_id });

    return NextResponse.json({ data: appointment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_cancel_error', { error: message }, 'error');

    if (message === 'Appointment not found') {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (message === 'Appointment already cancelled') {
      return NextResponse.json({ error: 'Appointment already cancelled' }, { status: 409 });
    }
    if (message === 'Appointment cannot be cancelled') {
      return NextResponse.json({ error: 'Appointment cannot be cancelled' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}