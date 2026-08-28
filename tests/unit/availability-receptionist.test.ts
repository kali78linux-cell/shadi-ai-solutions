import { describe, it, expect, vi, beforeEach } from 'vitest';

const bookingMocks = vi.hoisted(() => ({
  getActiveServiceById: vi.fn(),
  getAvailableSlots: vi.fn(),
}));

vi.mock('@/lib/services/bookingService', () => bookingMocks);
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { findEarliestAvailableSlot } from '@/lib/ai/availabilityTool';

/**
 * Deterministic clock for the fixed-date tests. The availability tool's
 * past-slot guard defaults to `new Date()` (real wall clock), so a test that
 * hard-codes `preferredDate` equal to "today" would flip PASS/FAIL depending
 * on the wall-clock time the suite runs. Pinning `now` to a fixed morning on
 * the fixture dates keeps every date-dependent assertion stable forever.
 */
const FIXED_NOW = new Date('2026-08-28T08:00:00.000Z');

/**
 * REAL AVAILABILITY TOOL — behavioral guard for the receptionist.
 * The AI must NEVER invent a date/time; it must present the earliest REAL slot
 * from the booking engine, and degrade to a structured reason (not "AI
 * unavailable") when no real slot / service exists.
 */
describe('findEarliestAvailableSlot (real availability tool)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the earliest real slot from the availability engine', async () => {
    bookingMocks.getActiveServiceById.mockResolvedValue({ id: 'svc', name: 'فحص أسنان', duration_minutes: 30 });
    // The engine returns a concrete slot on the first day we scan.
    bookingMocks.getAvailableSlots.mockResolvedValue(['2026-09-04T13:30:00.000Z']);

    const result = await findEarliestAvailableSlot({ clinicId: 'c1', providerId: 'p1', serviceId: 'svc', lookaheadDays: 5, now: FIXED_NOW });
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.slot).toBe('2026-09-04T13:30:00.000Z');
      expect(result.date).toBe('2026-09-04');
      expect(result.time).toBe('13:30');
    }
  });

  it('returns no_slots (structured, not an error) when nothing is available in the window', async () => {
    bookingMocks.getActiveServiceById.mockResolvedValue({ id: 'svc', name: 'Treat', duration_minutes: 30 });
    bookingMocks.getAvailableSlots.mockResolvedValue([]);
    const result = await findEarliestAvailableSlot({ clinicId: 'c1', providerId: 'p1', serviceId: 'svc', lookaheadDays: 3 });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('no_slots');
  });

  it('returns service_unavailable when the service is not active in this clinic', async () => {
    bookingMocks.getActiveServiceById.mockResolvedValue(null);
    const result = await findEarliestAvailableSlot({ clinicId: 'c1', providerId: 'p1', serviceId: 'missing' });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('service_unavailable');
  });

  it('aborts with a structured error when the provider is not assigned to the service', async () => {
    bookingMocks.getActiveServiceById.mockResolvedValue({ id: 'svc', name: 'X', duration_minutes: 30 });
    bookingMocks.getAvailableSlots.mockRejectedValue(new Error('Provider is not assigned to this service'));
    const result = await findEarliestAvailableSlot({ clinicId: 'c1', providerId: 'p1', serviceId: 'svc' });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.message).toContain('not assigned');
  });
});
describe('findEarliestAvailableSlot — STEP 3 constraints & timezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bookingMocks.getActiveServiceById.mockResolvedValue({ id: 'svc', name: 'فحص أسنان', duration_minutes: 30 });
  });

  it('restricts the search to the preferred date only', async () => {
    bookingMocks.getAvailableSlots.mockResolvedValue(['2026-08-28T09:00:00.000Z']);
    const result = await findEarliestAvailableSlot({
      clinicId: 'c1', providerId: 'p1', serviceId: 'svc', preferredDate: '2026-08-28',
      now: FIXED_NOW,
    });
    expect(result.found).toBe(true);
    expect(bookingMocks.getAvailableSlots).toHaveBeenCalledWith('c1', 'p1', '2026-08-28', 5, 'svc');
    expect(result.date).toBe('2026-08-28');
  });

  it('excludes past slots on today in the clinic timezone (never UTC-blind)', async () => {
    // 2026-08-27T10:30Z == 13:30 local in Asia/Jerusalem. 13:00 is in the past; 14:00 is not.
    const now = new Date('2026-08-27T10:30:00.000Z');
    bookingMocks.getAvailableSlots.mockResolvedValue([
      '2026-08-27T13:00:00.000Z',
      '2026-08-27T14:00:00.000Z',
    ]);
    const result = await findEarliestAvailableSlot({
      clinicId: 'c1', providerId: 'p1', serviceId: 'svc',
      timeZone: 'Asia/Jerusalem', now, lookaheadDays: 1,
    });
    expect(result.found).toBe(true);
    expect(result.time).toBe('14:00');
  });

  it('applies preferred_time_range (inclusive)', async () => {
    bookingMocks.getAvailableSlots.mockResolvedValue([
      '2026-08-28T09:00:00.000Z',
      '2026-08-28T14:00:00.000Z',
    ]);
    const result = await findEarliestAvailableSlot({
      clinicId: 'c1', providerId: 'p1', serviceId: 'svc', preferredDate: '2026-08-28',
      now: FIXED_NOW,
      preferredTimeRange: { from: '12:00', to: '17:00' },
    });
    expect(result.found).toBe(true);
    expect(result.time).toBe('14:00');
  });

  it('applies preferred_time_options and never invents slots', async () => {
    bookingMocks.getAvailableSlots.mockResolvedValue([
      '2026-08-28T09:00:00.000Z',
      '2026-08-28T13:00:00.000Z',
      '2026-08-28T16:00:00.000Z',
    ]);
    const result = await findEarliestAvailableSlot({
      clinicId: 'c1', providerId: 'p1', serviceId: 'svc', preferredDate: '2026-08-28',
      now: FIXED_NOW,
      preferredTimeOptions: ['13:00', '16:00'],
    });
    expect(result.found).toBe(true);
    expect(result.time).toBe('13:00');
  });

  it('returns no_slots when no real slot matches the constraints', async () => {
    bookingMocks.getAvailableSlots.mockResolvedValue(['2026-08-28T09:00:00.000Z']);
    const result = await findEarliestAvailableSlot({
      clinicId: 'c1', providerId: 'p1', serviceId: 'svc', preferredDate: '2026-08-28',
      now: FIXED_NOW,
      preferredTimeOptions: ['16:00'],
    });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('no_slots');
  });

  it('computes slotStart/slotEnd from the real slot + real service duration', async () => {
    bookingMocks.getAvailableSlots.mockResolvedValue(['2026-08-28T13:00:00.000Z']);
    const result = await findEarliestAvailableSlot({
      clinicId: 'c1', providerId: 'p1', serviceId: 'svc', preferredDate: '2026-08-28',
      now: FIXED_NOW,
    });
    expect(result.found).toBe(true);
    expect(result.slotStart).toBe('2026-08-28T13:00:00.000Z');
    expect(result.slotEnd).toBe('2026-08-28T13:30:00.000Z');
  });
});
