import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmPublicBooking } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

const confirmSchema = z.object({
  clinic_id: z.string().uuid(),
  appointment_id: z.string().uuid(),
  token: z.string().min(32).max(128),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = confirmSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid confirmation request', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, appointment_id, token } = parsed.data;

    const appointment = await confirmPublicBooking({
      clinicId: clinic_id,
      appointmentId: appointment_id,
      token,
    });

    logEvent('booking_confirmed', { clinic_id, appointment_id });

    return NextResponse.json({ data: appointment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_confirm_error', { error: message }, 'error');

    if (message === 'Appointment not found') {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (message === 'Appointment already confirmed') {
      return NextResponse.json({ error: 'Appointment already confirmed' }, { status: 409 });
    }
    if (message === 'Appointment cannot be confirmed') {
      return NextResponse.json({ error: 'Appointment cannot be confirmed' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}