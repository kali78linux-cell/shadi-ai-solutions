import { NextResponse } from 'next/server';
import { z } from 'zod';
import { findOrCreatePatient, createBooking, isValidBookingPhone } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';

const bookingSchema = z.object({
  clinic_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  service: z.string().min(1).max(200),
  service_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM'),
  patient_name: z.string().min(1).max(200),
  // Phone is REQUIRED to create an appointment (contact + reminders + reschedule/cancel).
  phone: z.string().trim().min(5).max(30),
  email: z.string().email().optional().nullable(),
  duration_minutes: z.coerce.number().int().min(15).max(480).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = bookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid booking request', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id, provider_id, service, service_id, conversation_id, date, time, patient_name, phone, email, duration_minutes } = parsed.data;

    // Hard phone requirement: a booking without a valid phone is rejected here,
    // BEFORE any patient or appointment record is created. Never relax this.
    if (!isValidBookingPhone(phone)) {
      return NextResponse.json(
        { error: 'A valid phone number is required to place an appointment' },
        { status: 400 },
      );
    }

    // 1. Find or create patient (tenant-scoped, never returns full patient record)
    const patientId = await findOrCreatePatient({
      clinicId: clinic_id,
      name: patient_name,
      phone,
      email: email ?? null,
    });

    // 2. Re-check availability and create tentative appointment
    const appointment = await createBooking({
      clinicId: clinic_id,
      providerId: provider_id,
      service,
      serviceId: service_id,
      date,
      time,
      patientId,
      durationMinutes: duration_minutes,
      conversationId: conversation_id ?? null,
    });

    logEvent('booking_created', { clinic_id: clinic_id, provider_id: provider_id, appointment_id: appointment.id });

    // Return only safe patient-facing data
    return NextResponse.json({
      data: {
        appointment_id: appointment.id,
        date,
        time,
        service,
        provider_id,
        status: appointment.status,
        booking_token: appointment.booking_token,
      },
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_error', { error: message }, 'error');

    if (message.includes('Provider not found')) {
      return NextResponse.json({ error: 'Provider not found for this clinic' }, { status: 404 });
    }
    if (message.includes('Provider is not assigned to this service')) {
      return NextResponse.json({ error: 'Provider is not assigned to this service' }, { status: 403 });
    }
    if (message.includes('Conversation not found')) {
      return NextResponse.json({ error: 'Conversation not found for this clinic' }, { status: 404 });
    }
    if (message.includes('Slot unavailable')) {
      return NextResponse.json({ error: 'The requested slot is no longer available. Please check availability again.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
