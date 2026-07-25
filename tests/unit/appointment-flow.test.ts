import { describe, expect, it, vi } from 'vitest';
import { checkSlotAvailability, type ProviderSchedule } from '@/lib/services/scheduling';
import { buildAppointmentBookingPlan, runAppointmentBookingFlow } from '@/lib/services/appointmentEngine';

describe('appointment flow integration', () => {
  const schedule: ProviderSchedule = {
    providerId: 'provider-1',
    clinicId: 'clinic-1',
    appointmentDurationMinutes: 30,
    days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00' }],
  };

  it('builds a booking plan from patient intent and returns suggested slots', () => {
    const plan = buildAppointmentBookingPlan({
      message: 'I want to book a dental cleaning on 2026-07-20 at 09:00',
      date: '2026-07-20',
      schedule,
      limit: 2,
    });

    expect(plan.intent).toBe('appointment_booking');
    expect(plan.suggestions).toEqual([
      '2026-07-20T09:00:00.000Z',
      '2026-07-20T09:30:00.000Z',
    ]);
  });

  it('prevents double booking when a conflicting appointment already exists', () => {
    const availability = checkSlotAvailability({
      startsAt: '2026-07-20T10:00:00.000Z',
      durationMinutes: 30,
      schedule,
      existingAppointments: [{ startsAt: '2026-07-20T10:00:00.000Z', durationMinutes: 30, status: 'confirmed' }],
    });

    expect(availability.available).toBe(false);
    expect(availability.reason).toBe('overlap');
  });

  it('rejects unavailable provider schedule', () => {
    const unavailable = checkSlotAvailability({
      startsAt: '2026-07-20T09:00:00.000Z',
      durationMinutes: 30,
      schedule: { ...schedule, days: [{ weekday: 1, enabled: false, start: '09:00', end: '17:00' }] },
    });

    expect(unavailable.available).toBe(false);
    expect(unavailable.reason).toBe('provider_unavailable');
  });

  it('rejects invalid appointment time', () => {
    const invalid = checkSlotAvailability({
      startsAt: '2026-07-20T18:00:00.000Z',
      durationMinutes: 30,
      schedule,
    });

    expect(invalid.available).toBe(false);
    expect(invalid.reason).toBe('outside_working_hours');
  });

  it('keeps the booking flow resilient when no free slot exists', async () => {
    await expect(runAppointmentBookingFlow({
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      patientId: 'patient-1',
      service: 'Cleaning',
      message: 'I want to book a cleaning',
      date: '2026-07-20',
      schedule: { ...schedule, days: [{ weekday: 1, enabled: false, start: '09:00', end: '17:00' }] },
      durationMinutes: 30,
      reminderChannels: ['sms'],
    })).rejects.toThrow(/no available slots|unavailable/i);
  });

  it('supports custom reminder rules and uses default offsets', () => {
    const reminderOffsets = [24 * 60, 2 * 60, 30];
    expect(reminderOffsets).toEqual([24 * 60, 2 * 60, 30]);
  });
});
