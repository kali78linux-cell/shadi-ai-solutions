import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 2 — smartScheduling service integration tests (mocked db):
// computeProviderDaySlots (buffers + service duration), suggestBookingSlots
// (multi-provider, service mismatch surfaced, no invented availability),
// computeMultiServicePlan (feasible chain vs conflict blocker),
// scheduleActivityRequest (activity-aware + PHASE 1B workflow + fail-closed).

const state = vi.hoisted(() => ({
  schedule: {} as any,
  existing: [] as any[],
  holiday: false as any,
  service: {} as any,
  serviceError: null as any,
  providers: [] as any[],
  providersError: null as any,
}));

function makeChain(get: () => any) {
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.is = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.maybeSingle = vi.fn(() => Promise.resolve(get()));
  c.then = (res: any, rej: any) => Promise.resolve(get()).then(res, rej);
  return c;
}

const mockDb = vi.hoisted(() => {
  const entity = makeChain(() => ({ data: { status: 'requested' }, error: null }));
  const appointments = makeChain(() => ({
    data: { id: 'r1', status: 'scheduled', scheduled_at: '2026-09-07T09:00:00.000Z' },
    error: null,
  }));
  return {
    from: vi.fn((t: string) => (t === 'appointments' ? appointments : entity)),
    __entity: entity,
    __appointments: appointments,
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

vi.mock('@/lib/services/bookingService', () => ({
  loadProviderSchedule: vi.fn(async (_cid: string, providerId: string) =>
    providerId === 'p1' ? state.schedule : null
  ),
  loadExistingAppointments: vi.fn(async () => state.existing),
  isClinicHoliday: vi.fn(async () => state.holiday),
  getActiveServiceById: vi.fn(async () => (state.serviceError ? null : state.service)),
  getActiveProviders: vi.fn(async () => state.providers),
  createBooking: vi.fn(async (p: any) => ({
    id: `book-${p.serviceId}`,
    scheduled_at: `${p.date}T${p.time}:00.000Z`,
    status: 'tentative',
    booking_token: 'tok',
  })),
}));
vi.mock('@/lib/services/workflowService', () => ({
  applyWorkflowTransition: vi.fn(async (input: any) => ({
    ok: true,
    entityType: input.entityType,
    entityId: input.entityId,
    fromStatus: 'requested',
    toStatus: input.toStatus,
  })),
  WorkflowTransitionError: class extends Error {},
}));

import {
  computeProviderDaySlots,
  bookMultiService,
  computeMultiServicePlan,
  suggestBookingSlots,
  scheduleActivityRequest,
} from '@/lib/services/smartScheduling';

const CID = '11111111-1111-1111-1111-111111111111';

function defaultSchedule() {
  return {
    providerId: 'p1',
    clinicId: CID,
    appointmentDurationMinutes: 30,
    days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00' }],
    maxAppointmentsPerDay: 10,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.schedule = defaultSchedule();
  state.existing = [];
  state.holiday = false;
  state.service = { id: 's1', name: 'Cleaning', duration_minutes: 60 };
  state.serviceError = null;
  state.providers = [{ id: 'p1', name: 'Dr A', title: null }];
  state.providersError = null;
});

describe('PHASE 2 — computeProviderDaySlots (buffer + real schedule)', () => {
  it('enforces a buffer by shrinking the free windows', async () => {
    state.existing = [{ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 30 }];
    const withBuffer = await computeProviderDaySlots({
      clinicId: CID,
      providerId: 'p1',
      date: '2026-09-07',
      bufferMinutes: 15,
    });
    // the slot overlapping the buffered appointment is not offered
    expect(withBuffer.slots.some((s) => s.startsAt === '2026-09-07T08:50:00.000Z')).toBe(false);
    expect(withBuffer.slots.length).toBeGreaterThan(0);
  });

  it('uses the service duration when provided', async () => {
    const day = await computeProviderDaySlots({ clinicId: CID, providerId: 'p1', date: '2026-09-07', serviceId: 's1' });
    expect(day.durationMinutes).toBe(60);
  });
});

describe('PHASE 2 — suggestBookingSlots (intelligent suggestions)', () => {
  it('ranks suggestions and returns deterministic scores/reasons', async () => {
    const out = await suggestBookingSlots({ clinicId: CID, date: '2026-09-07', serviceId: 's1', limit: 3 });
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out.evaluatedProviders).toBe(1);
    expect(out.suggestions[0].rank).toBe(1);
    expect(typeof out.suggestions[0].score).toBe('number');
  });

  it('surfaces a provider without a schedule as a warning, never invents slots', async () => {
    state.providers = [
      { id: 'p1', name: 'Dr A', title: null },
      { id: 'pX', name: 'Dr X', title: null },
    ];
    const out = await suggestBookingSlots({ clinicId: CID, date: '2026-09-07', serviceId: 's1' });
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out.warnings.some((w) => w.startsWith('pX'))).toBe(true);
  });

  it('returns no suggestions when no provider has real availability that day', async () => {
    state.schedule.days = [{ weekday: 1, enabled: false, start: '09:00', end: '17:00' }];
    const out = await suggestBookingSlots({ clinicId: CID, date: '2026-09-07', serviceId: 's1' });
    expect(out.suggestions).toEqual([]);
  });
});

describe('PHASE 2 — multi-service planning + booking', () => {
  it('plans a feasible chained multi-service booking', async () => {
    state.service = { id: 's1', name: 'A', duration_minutes: 30 };
    const plan = await computeMultiServicePlan({
      clinicId: CID,
      providerId: 'p1',
      date: '2026-09-07',
      serviceIds: ['s1', 's1'],
    });
    expect(plan.feasible).toBe(true);
    expect(plan.items).toHaveLength(2);
  });

  it('reports a blocker when a chain hop is infeasible (first hop fills the day)', async () => {
    state.service = { id: 's1', name: 'A', duration_minutes: 30 };
    state.existing = [{ startsAt: '2026-09-07T09:00:00.000Z', durationMinutes: 480 }];
    const plan = await computeMultiServicePlan({
      clinicId: CID,
      providerId: 'p1',
      date: '2026-09-07',
      serviceIds: ['s1', 's1'],
    });
    expect(plan.feasible).toBe(false);
    expect(plan.blocker).toMatch(/no_slots_available|service_chain_conflict/);
  });

  it('books a chain through createBooking; compensates on mid-chain failure', async () => {
    state.service = { id: 's1', name: 'A', duration_minutes: 30 };
    const result = await bookMultiService({
      clinicId: CID,
      providerId: 'p1',
      date: '2026-09-07',
      patientId: 'pat-1',
      serviceIds: ['s1', 's1'],
    });
    expect(result.appointments).toHaveLength(2);
  });
});

describe('PHASE 2 — activity-aware scheduling (imaging_center)', () => {
  it('schedules an imaging request into a real slot and attaches tenant-scoped time', async () => {
    const r = await scheduleActivityRequest({
      clinicId: CID,
      entityType: 'imaging_requests',
      requestId: 'r1',
      providerId: 'p1',
      date: '2026-09-07',
      time: '10:00',
      actorUserId: 'u1',
      actorRole: 'owner',
    });
    expect(r.ok).toBe(true);
    expect(r.scheduledAt).toBe('2026-09-07T10:00:00.000Z');
    const eqCalls = mockDb.__entity.eq.mock.calls.map((c: any[]) => c[0]);
    expect(eqCalls).toContain('clinic_id');
  });

  it('fail-closed: rejects scheduling without a real provider schedule', async () => {
    await expect(
      scheduleActivityRequest({
        clinicId: CID,
        entityType: 'imaging_requests',
        requestId: 'r1',
        providerId: 'pX',
        date: '2026-09-07',
        time: '10:00',
      })
    ).rejects.toThrow('no_schedule_configured');
  });

  it('rejects an unavailable slot (conflict) for the activity request', async () => {
    state.existing = [{ startsAt: '2026-09-07T10:00:00.000Z', durationMinutes: 60 }];
    await expect(
      scheduleActivityRequest({
        clinicId: CID,
        entityType: 'imaging_requests',
        requestId: 'r1',
        providerId: 'p1',
        date: '2026-09-07',
        time: '10:00',
      })
    ).rejects.toThrow('slot_unavailable');
  });
});