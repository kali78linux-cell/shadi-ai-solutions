import { describe, expect, it } from 'vitest';
import { checkSlotAvailability, getCalendarRange, suggestFreeSlots, type ProviderSchedule } from '@/lib/services/scheduling';

const schedule: ProviderSchedule = {
  providerId: 'provider-1',
  clinicId: 'clinic-1',
  appointmentDurationMinutes: 30,
  days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }],
};

describe('appointment scheduling', () => {
  it('supports day, week, and month calendar ranges', () => {
    expect(getCalendarRange('2026-07-20', 'day').end).toContain('2026-07-21');
    expect(getCalendarRange('2026-07-22', 'week').start).toContain('2026-07-19');
    expect(getCalendarRange('2026-07-22', 'month').start).toContain('2026-07-01');
  });

  it('rejects overlapping appointments and breaks', () => {
    const overlap = checkSlotAvailability({
      startsAt: '2026-07-20T10:15:00.000Z',
      durationMinutes: 30,
      schedule,
      existingAppointments: [{ startsAt: '2026-07-20T10:00:00.000Z', durationMinutes: 30, status: 'confirmed' }],
    });
    expect(overlap).toMatchObject({ available: false, reason: 'overlap' });
    expect(checkSlotAvailability({ startsAt: '2026-07-20T12:15:00.000Z', durationMinutes: 30, schedule }).reason).toBe('break_time');
  });

  it('suggests available slots while respecting working hours', () => {
    const slots = suggestFreeSlots({ date: '2026-07-20', schedule, limit: 3 });
    expect(slots).toEqual([
      '2026-07-20T09:00:00.000Z',
      '2026-07-20T09:30:00.000Z',
      '2026-07-20T10:00:00.000Z',
    ]);
  });

  it('rejects vacation and holiday dates', () => {
    const vacation = checkSlotAvailability({ startsAt: '2026-07-20T09:00:00.000Z', durationMinutes: 30, schedule: { ...schedule, vacationDates: ['2026-07-20'] } });
    expect(vacation.reason).toBe('vacation');
    const holiday = checkSlotAvailability({ startsAt: '2026-07-20T09:00:00.000Z', durationMinutes: 30, schedule, holiday: true });
    expect(holiday.reason).toBe('holiday');
  });
});
