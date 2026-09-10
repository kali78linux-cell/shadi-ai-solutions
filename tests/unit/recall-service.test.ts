import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 3 — Patient Recall core tests: pure eligibility + DND resolution +
// generation pipeline (assignments + queue rows) with mocked db, opt-out
// skip, active-recall dedupe, disabled rules.

const state = vi.hoisted(() => ({
  rules: {} as any,
  rulesError: null as any,
  appointments: [] as any[],
  appointmentsError: null as any,
  activeRecalls: [] as any[],
  activeError: null as any,
  prefs: [] as any[],
  prefsError: null as any,
  insertError: null as any,
  insertData: { id: 'rc1' } as any,
  queueRows: [{ id: 'q1' }, { id: 'q2' }] as any[],
  queueError: null as any,
  insertMode: false,
}));

const mockDb = vi.hoisted(() => {
  function chain(get: () => any) {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.in = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.order = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.insert = vi.fn(() => c);
    c.update = vi.fn(() => c);
    c.upsert = vi.fn(() => c);
    c.onConflict = vi.fn(() => c);
    c.single = vi.fn(() => Promise.resolve(get()));
    c.maybeSingle = vi.fn(() => Promise.resolve(get()));
    c.then = (res: any, rej: any) => Promise.resolve(get()).then(res, rej);
    return c;
  }
  const appointments = chain(() => ({ data: state.appointments, error: state.appointmentsError }));
  const recallActive = chain(() => ({ data: state.activeRecalls, error: state.activeError }));
  const recallInsert = chain(() => ({ data: state.insertData, error: state.insertError }));
  const prefsTable = chain(() => ({ data: state.prefs, error: state.prefsError }));
  const queue = chain(() => ({ data: state.queueRows, error: state.queueError }));
  const rulesTable = chain(() => ({ data: state.rules, error: state.rulesError }));
  return {
    from: vi.fn((t: string) => {
      if (t === 'appointments') return appointments;
      // generation inserts go to the same table; reads hit activeRecalls
      if (t === 'recall_assignments') return state.insertMode ? recallInsert : recallActive;
      if (t === 'patient_notification_preferences') return prefsTable;
      if (t === 'notification_queue') return queue;
      if (t === 'recall_rules') return rulesTable;
      return recallActive;
    }),
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  isPatientEligibleForRecall,
  resolveDndScheduleTime,
  computeEligibleRecalls,
  runRecallGeneration,
} from '@/lib/services/recallService';

const CID = '11111111-1111-1111-1111-111111111111';

// The generation flow reads recall_assignments (active) then inserts into it;
// the mock needs a mode switch per test phase.

beforeEach(() => {
  vi.clearAllMocks();
  state.insertMode = false;
  (mockDb.from as any).mockImplementation((t: string) => {
    if (t === 'appointments') {
      return makeChainFrom(() => ({ data: state.appointments, error: state.appointmentsError }));
    }
    if (t === 'recall_assignments') {
      return makeChainFrom(() =>
        state.insertMode
          ? { data: state.insertData, error: state.insertError }
          : { data: state.activeRecalls, error: state.activeError }
      );
    }
    if (t === 'patient_notification_preferences') {
      return makeChainFrom(() => ({ data: state.prefs, error: state.prefsError }));
    }
    if (t === 'notification_queue') {
      return makeChainFrom(() => ({ data: state.queueRows, error: state.queueError }));
    }
    if (t === 'recall_rules') {
      return makeChainFrom(() => ({ data: state.rules, error: state.rulesError }));
    }
    return makeChainFrom(() => ({ data: state.activeRecalls, error: state.activeError }));
  });
  state.rules = { clinic_id: CID, enabled: true, interval_days: 180, channels: ['sms', 'email'] };
  state.rulesError = null;
  state.appointments = [];
  state.appointmentsError = null;
  state.activeRecalls = [];
  state.activeError = null;
  state.prefs = [];
  state.prefsError = null;
  state.insertError = null;
  state.insertData = { id: 'rc1' };
  state.queueRows = [{ id: 'q1' }, { id: 'q2' }];
  state.queueError = null;
});

function makeChainFrom(get: () => any) {
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.is = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.onConflict = vi.fn(() => c);
  c.single = vi.fn(() => Promise.resolve(get()));
  c.maybeSingle = vi.fn(() => Promise.resolve(get()));
  c.then = (res: any, rej: any) => Promise.resolve(get()).then(res, rej);
  return c;
}

describe('PHASE 3 — eligibility (pure)', () => {
  it('eligible when last visit is older than interval', () => {
    expect(isPatientEligibleForRecall({ lastVisitDate: '2026-01-01', intervalDays: 180, todayIso: '2026-09-03' })).toBe(true);
  });

  it('not eligible inside the interval', () => {
    expect(isPatientEligibleForRecall({ lastVisitDate: '2026-08-01', intervalDays: 180, todayIso: '2026-09-03' })).toBe(false);
  });

  it('not eligible without a last visit', () => {
    expect(isPatientEligibleForRecall({ lastVisitDate: null, intervalDays: 180 })).toBe(false);
  });
});

describe('PHASE 3 — DND resolution (pure)', () => {
  it('passes through when no DND set', () => {
    const now = new Date('2026-09-03T14:00:00Z');
    expect(resolveDndScheduleTime(now, null, null)).toBe(now);
  });

  it('defers to dnd_end when inside a same-day window', () => {
    // DND 08:00–20:00, now 14:00 → deferred to today 20:00
    const out = resolveDndScheduleTime(new Date('2026-09-03T14:00:00Z'), '08:00', '20:00');
    expect(out.toISOString()).toBe('2026-09-03T20:00:00.000Z');
  });

  it('defers past-midnight windows correctly', () => {
    // DND 22:00–06:00, now 23:30 → deferred to tomorrow 06:00
    const out = resolveDndScheduleTime(new Date('2026-09-03T23:30:00Z'), '22:00', '06:00');
    expect(out.toISOString()).toBe('2026-09-04T06:00:00.000Z');
  });

  it('passes through outside the window', () => {
    const now = new Date('2026-09-03T21:00:00Z'); // 21:00 not in 08:00–20:00
    expect(resolveDndScheduleTime(now, '08:00', '20:00')).toBe(now);
  });
});

describe('PHASE 3 — computeEligibleRecalls (db-driven)', () => {
  it('includes eligible patients with contact info', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: '05', email: 'a@x.com' } },
    ];
    const out = await computeEligibleRecalls({ clinicId: CID, intervalDays: 180 });
    expect(out).toHaveLength(1);
    expect(out[0].patientId).toBe('p1');
  });

  it('excludes patients with an active recall', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: '05', email: 'a@x.com' } },
    ];
    state.activeRecalls = [{ patient_id: 'p1' }];
    const out = await computeEligibleRecalls({ clinicId: CID, intervalDays: 180 });
    expect(out).toHaveLength(0);
  });

  it('excludes opt-out patients', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: '05', email: 'a@x.com' } },
    ];
    state.prefs = [{ patient_id: 'p1', opt_out: true }];
    const out = await computeEligibleRecalls({ clinicId: CID, intervalDays: 180 });
    expect(out).toHaveLength(0);
  });

  it('excludes patients without any contact info (not notifiable)', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: null, email: null } },
    ];
    const out = await computeEligibleRecalls({ clinicId: CID, intervalDays: 180 });
    expect(out).toHaveLength(0);
  });
});

describe('PHASE 3 — runRecallGeneration', () => {
  it('skips generation entirely when rules are disabled', async () => {
    state.rules = { clinic_id: CID, enabled: false, interval_days: 180, channels: ['sms'] };
    const out = await runRecallGeneration({ clinicId: CID });
    expect(out).toEqual({ eligible: 0, created: 0, skippedActive: 0, queueRows: 0 });
  });

  it('creates an assignment + queue rows per channel for eligible patients', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: '05', email: 'a@x.com' } },
    ];
    state.insertMode = true; // after eligibility reads, the insert goes to recall_assignments
    const out = await runRecallGeneration({ clinicId: CID });
    expect(out.created).toBe(1);
    expect(out.queueRows).toBe(2); // sms + email
  });

  it('dedupes: patients with an active recall are excluded before insert', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: '05', email: 'a@x.com' } },
    ];
    state.activeRecalls = [{ patient_id: 'p1' }];
    const out = await runRecallGeneration({ clinicId: CID });
    expect(out.created).toBe(0);
  });

  it('handles queue insert failure without throwing (logged)', async () => {
    state.appointments = [
      { patient_id: 'p1', appointment_date: '2026-01-01', status: 'completed', patients: { id: 'p1', name: 'Adam', phone: '05', email: 'a@x.com' } },
    ];
    state.insertMode = true;
    state.queueError = { message: 'queue constraint' };
    const out = await runRecallGeneration({ clinicId: CID });
    expect(out.created).toBe(1);
    expect(out.queueRows).toBe(0);
  });
});