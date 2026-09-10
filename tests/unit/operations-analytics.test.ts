import { describe, it, expect } from 'vitest';
import { computeFunnel, computeScheduleMetrics, mapAiUsage, defaultPeriod } from '@/lib/services/operationsAnalytics';

const P1 = '33333333-3333-3333-3333-333333333331';
const P2 = '33333333-3333-3333-3333-333333333332';

describe('computeFunnel', () => {
  it('computes counts and conversion rates correctly', () => {
    const appointments = [
      { status: 'completed', service_id: 'svc-1' },
      { status: 'completed', service_id: null },
      { status: 'confirmed', service_id: 'svc-2' },
      { status: 'cancelled', service_id: null },
      { status: 'no_show', service_id: null },
    ];
    const f = computeFunnel(appointments, 10);
    expect(f.bookings).toBe(5);
    expect(f.completed).toBe(2);
    expect(f.cancelled).toBe(1);
    expect(f.noShow).toBe(1);
    // reached-confirmation = confirmed + completed
    expect(f.confirmed).toBe(3);
    expect(f.completionRate).toBeCloseTo(0.4);
    expect(f.cancellationRate).toBeCloseTo(0.2);
    expect(f.noShowRate).toBeCloseTo(0.2);
    expect(f.confirmationRate).toBeCloseTo(0.6);
    expect(f.conversationToBookingRate).toBeCloseTo(0.5);
  });

  it('handles zero denominators without NaN (rates = 0)', () => {
    const f = computeFunnel([], 0);
    expect(f.bookings).toBe(0);
    expect(f.completionRate).toBe(0);
    expect(f.conversationToBookingRate).toBe(0);
    expect(f.serviceIdLinkageRate).toBe(0);
  });

  it('tracks service_id linkage for future accounting path', () => {
    const f = computeFunnel(
      [
        { status: 'completed', service_id: 'svc-1' },
        { status: 'completed', service_id: 'svc-2' },
        { status: 'scheduled', service_id: null },
      ],
      3,
    );
    expect(f.serviceIdLinkedBookings).toBe(2);
    expect(f.serviceIdLinkageRate).toBeCloseTo(2 / 3);
  });
});

describe('computeScheduleMetrics', () => {
  // 2026-08-31 is a Monday (getUTCDay()=1, schema weekday 0=Sun..6=Sat). 2-day period.
  const from = '2026-08-31T00:00:00.000Z';
  const to = '2026-09-01T23:59:59.999Z';
  const providers = [
    { id: P1, name: 'د. سارة' },
    { id: P2, name: 'د. أحمد' },
  ];
  const schedules = [
    { provider_id: P1, weekday: 1, enabled: true, start_time: '09:00', end_time: '17:00' }, // Mon 480m
    { provider_id: P1, weekday: 2, enabled: true, start_time: '09:00', end_time: '13:00' }, // Tue 240m
    { provider_id: P2, weekday: 1, enabled: false, start_time: '09:00', end_time: '17:00' }, // disabled → 0
  ];

  it('computes utilization, occupied and gap minutes from schedules + appointments', () => {
    const appointments = [
      { provider_id: P1, status: 'completed', scheduled_at: '2026-08-31T09:00:00Z', duration_minutes: 120 },
      { provider_id: P1, status: 'scheduled', scheduled_at: '2026-08-31T14:00:00Z', duration_minutes: 60 },
      // Cancelled does NOT occupy the slot
      { provider_id: P1, status: 'cancelled', scheduled_at: '2026-08-31T16:00:00Z', duration_minutes: 45 },
      { provider_id: P1, status: 'confirmed', scheduled_at: '2026-09-01T10:00:00Z', duration_minutes: 30 },
    ];
    const result = computeScheduleMetrics(appointments, providers, schedules, from, to);
    const sara = result.find((r) => r.providerId === P1)!;
    // available = 480 (Mon) + 240 (Tue) = 720
    expect(sara.availableMinutes).toBe(720);
    // occupied = 120+60 (Mon) + 30 (Tue) = 210
    expect(sara.occupiedMinutes).toBe(210);
    expect(sara.gapMinutes).toBe(510);
    expect(sara.utilization).toBeCloseTo(210 / 720);
    expect(sara.appointments).toBe(4);
    expect(sara.completed).toBe(1);
    expect(sara.cancelled).toBe(1);
    expect(sara.noShow).toBe(0);
    // Disabled schedule ⇒ no available minutes, utilization null
    const ahmad = result.find((r) => r.providerId === P2)!;
    expect(ahmad.availableMinutes).toBe(0);
    expect(ahmad.utilization).toBeNull();
    expect(ahmad.gapMinutes).toBe(0);
  });

  it('defaults duration to 30 minutes when null', () => {
    const result = computeScheduleMetrics(
      [{ provider_id: P1, status: 'scheduled', scheduled_at: '2026-08-31T09:00:00Z', duration_minutes: null }],
      providers,
      schedules,
      '2026-08-31T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z',
    );
    expect(result[0].occupiedMinutes).toBe(30);
  });

  it('returns null utilization when provider has no schedule even if occupied', () => {
    const result = computeScheduleMetrics(
      [{ provider_id: P1, status: 'completed', scheduled_at: '2026-08-31T09:00:00Z', duration_minutes: null }],
      providers,
      [],
      '2026-08-31T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z',
    );
    expect(result[0].occupiedMinutes).toBe(30);
    expect(result[0].utilization).toBeNull();
  });
});

describe('mapAiUsage (null = unlimited semantics)', () => {
  it('marks null limits as unlimited with null remaining (never 0/fallback)', () => {
    const rows = mapAiUsage({
      ai_messages: { limit: 5, used: 2 },
      growth_key: { limit: null, used: null },
    });
    const ai = rows.find((r) => r.resource === 'ai_messages')!;
    expect(ai).toEqual({ resource: 'ai_messages', used: 2, limit: 5, remaining: 3, unlimited: false });
    const unlimited = rows.find((r) => r.resource === 'growth_key')!;
    expect(unlimited.unlimited).toBe(true);
    expect(unlimited.remaining).toBeNull();
    expect(unlimited.used).toBe(0); // missing counter row ⇒ displayed as 0 used
  });

  it('clamps remaining at zero when over limit', () => {
    const rows = mapAiUsage({ ai_messages: { limit: 5, used: 7 } });
    expect(rows[0].remaining).toBe(0);
  });
});

describe('defaultPeriod', () => {
  it('returns a 30-day window with from before to', () => {
    const { from, to } = defaultPeriod();
    expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime());
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(31);
  });
});

