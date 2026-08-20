import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reschedulePublicBooking } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

const rescheduleSchema = z.object({
  clinic_id: z.string().uuid(),
  appointment_id: z.string().uuid(),
  token: z.string().min(32).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:MM)'),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = rescheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid reschedule request', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, appointment_id, token, date, time } = parsed.data;

    const appointment = await reschedulePublicBooking({
      clinicId: clinic_id,
      appointmentId: appointment_id,
      token,
      date,
      time,
    });

    logEvent('booking_rescheduled', { clinic_id, appointment_id, new_date: date, new_time: time });

    // Public-safe response — no internal fields, no booking token, no patient data.
    const scheduledAt = String(appointment.scheduled_at ?? '');
    const timeFromDate = scheduledAt.includes('T')
      ? scheduledAt.slice(11, 16)          // "2026-08-24T10:30:00+00:00" → "10:30"
      : (appointment as any).time ?? time;  // fallback to the requested time

    return NextResponse.json({
      data: {
        id: appointment.id,
        date: appointment.appointment_date,
        time: timeFromDate,
        status: appointment.status,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_reschedule_error', { error: message }, 'error');

    if (message === 'Appointment not found') {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (message.startsWith('Appointment cannot be rescheduled')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.startsWith('Requested slot is unavailable') || message.startsWith('Slot was just booked')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}