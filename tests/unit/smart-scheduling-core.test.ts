import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 2 — Smart Scheduling core tests. All availability is derived from REAL
// schedules/durations/holidays/vacations/appointments passed to the pure and
// service primitives — nothing is invented.

import { rankSlots } from '@/lib/services/smartScheduling';
import { checkSlotAvailability, suggestFreeSlots, type ProviderSchedule } from '@/lib/services/scheduling';

function schedule(over: Partial<ProviderSchedule> = {}): ProviderSchedule {
  return {
    providerId: 'p1',
    clinicId: 'c1',
    appointmentDurationMinutes: 30,
    days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00' }],
    maxAppointmentsPerDay: 10,
    ...over,
  };
}

describe('PHASE 2 — availability primitives (real data only)', () => {
  it('available within working hours', () => {
    expect(checkSlotAvailability({ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 30, schedule: schedule(), existingAppointments: [] }).available).toBe(true);
  });

  it('rejects outside working hours / past end', () => {
    const r = checkSlotAvailability({ startsAt: '2026-09-07T18:00:00.000Z', durationMinutes: 30, schedule: schedule(), existingAppointments: [] });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('outside_working_hours');
  });

  it('rejects holiday', () => {
    const r = checkSlotAvailability({ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 30, schedule: schedule(), existingAppointments: [], holiday: true });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('holiday');
  });

  it('rejects provider vacation on that date', () => {
    const s = schedule({ vacationDates: ['2026-09-07'] });
    const r = checkSlotAvailability({ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 30, schedule: s, existingAppointments: [] });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('vacation');
  });

  it('rejects overlapping an existing appointment', () => {
    const existing = [{ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 30 }];
    const r = checkSlotAvailability({ startsAt: '2026-09-07T09:15:00.000Z', durationMinutes: 30, schedule: schedule(), existingAppointments: existing });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('overlap');
  });

  it('rejects provider unavailable day (disabled weekday)', () => {
    const s = schedule({ days: [{ weekday: 1, enabled: false, start: '09:00', end: '17:00' }] });
    const r = checkSlotAvailability({ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 30, schedule: s, existingAppointments: [] });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('provider_unavailable');
  });

  it('rejects exceeding the daily appointment cap', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ startsAt: `2026-09-07T0${i}:00:00.000Z`, durationMinutes: 30 }));
    const s = schedule({ maxAppointmentsPerDay: 10 });
    const r = checkSlotAvailability({ startsAt: '2026-09-07T14:00:00.000Z', durationMinutes: 30, schedule: s, existingAppointments: existing });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('maximum_daily_appointments');
  });

  it('rejects break-time slots', () => {
    const s = schedule({ days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }] });
    const r = checkSlotAvailability({ startsAt: '2026-09-07T12:30:00.000Z', durationMinutes: 30, schedule: s, existingAppointments: [] });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('break_time');
  });

  it('invalid duration is rejected', () => {
    const r = checkSlotAvailability({ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 0, schedule: schedule(), existingAppointments: [] });
    expect(r.reason).toBe('invalid_duration');
  });

  it('suggestFreeSlots lists slots with the service duration', () => {
    const slots = suggestFreeSlots({ date: '2026-09-07', schedule: schedule(), existingAppointments: [] });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toBe('2026-09-07T09:00:00.000Z');
  });
});

describe('PHASE 2 — slot ranking (deterministic, data-driven)', () => {
  const candidates = [
    { startsAt: '2026-09-07T15:00:00.000Z', providerId: 'p1' },
    { startsAt: '2026-09-07T09:00:00.000Z', providerId: 'p1' },
    { startsAt: '2026-09-07T12:30:00.000Z', providerId: 'p2' },
  ];

  it('ranks earlier slots first by default', () => {
    const ranked = rankSlots(candidates, []);
    expect(ranked[0].startsAt).toBe('2026-09-07T09:00:00.000Z');
    // recent first is deterministic on ties by startsAt
    expect(ranked).toHaveLength(3);
  });

  it('boosts morning window (morning preference)', () => {
    const out = rankSlots(candidates, [], 'morning');
    expect(out[0].startsAt).toBe('2026-09-07T09:00:00.000Z');
    expect(out[0].reason).toContain('preferred_morning');
  });

  it('favors a slot that fills a gap right after an existing appointment', () => {
    const existing = [{ startsAt: '2026-09-07T08:30:00.000Z', durationMinutes: 30 }]; // ends 09:00
    const out = rankSlots([{ startsAt: '2026-09-07T09:00:00.000Z', providerId: 'p1' }, { startsAt: '2026-09-07T15:00:00.000Z', providerId: 'p1' }], existing);
    expect(out[0].startsAt).toBe('2026-09-07T09:00:00.000Z');
    expect(out[0].reason).toContain('fills_gap');
  });

  it('sorts deterministically on equal scores (earlier startsAt wins)', () => {
    const out = rankSlots(
      [
        { startsAt: '2026-09-07T11:00:00.000Z', providerId: 'p1' },
        { startsAt: '2026-09-07T10:00:00.000Z', providerId: 'p2' },
      ],
      []
    );
    expect(out[0].startsAt).toBe('2026-09-07T10:00:00.000Z');
  });
});