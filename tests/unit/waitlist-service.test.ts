import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 2 — waitlist service tests (mocked db): create, tenant-scoped list,
// cancel entry, and deterministic matching after a cancellation frees a slot.

const results = vi.hoisted(() => ({
  entries: [] as any[],
  error: null as any,
  single: { data: { id: 'w1' }, error: null } as any,
}));

const mockDb = vi.hoisted(() => {
  function chain() {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.order = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.in = vi.fn(() => c);
    c.insert = vi.fn(() => c);
    c.update = vi.fn(() => c);
    c.single = vi.fn(() => Promise.resolve(results.single));
    c.then = (res: any, rej: any) => Promise.resolve({ data: results.entries, error: results.error }).then(res, rej);
    return c;
  }
  return { from: vi.fn(() => chain()), __chain: null as any };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  addToWaitlist,
  listWaitlist,
  cancelWaitlistEntry,
  matchWaitlistAfterCancellation,
} from '@/lib/services/waitlistService';

const CID = '11111111-1111-1111-1111-111111111111';

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    clinic_id: CID,
    provider_id: 'p1',
    service_id: 's1',
    preferred_date: '2026-09-07',
    preferred_window: 'morning',
    contact_name: 'Adam',
    contact_phone: '0500000000',
    status: 'active',
    notes: null,
    created_at: '2026-09-01T08:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  results.entries = [];
  results.error = null;
  results.single = { data: { id: 'w1' }, error: null };
});

describe('PHASE 2 — waitlist create/list/cancel', () => {
  it('creates an active entry server-side', async () => {
    const e = await addToWaitlist({
      clinicId: CID,
      contactName: 'Adam',
      contactPhone: '0500000000',
      providerId: 'p1',
      serviceId: 's1',
      preferredDate: '2026-09-07',
      preferredWindow: 'morning',
    });
    expect(e.id).toBe('w1');
    expect(mockDb.from).toHaveBeenCalledWith('appointment_waitlist');
  });

  it('lists entries tenant-scoped with optional status filter', async () => {
    results.entries = [entry()];
    const list = await listWaitlist({ clinicId: CID, status: 'active' });
    expect(list).toHaveLength(1);
  });

  it('cancels an entry scoped to the tenant', async () => {
    await cancelWaitlistEntry(CID, 'w1');
    expect(mockDb.from).toHaveBeenCalledWith('appointment_waitlist');
  });
});

describe('PHASE 2 — waitlist matching after cancellation', () => {
  it('notifies matching active entries and flips them to notified', async () => {
    results.entries = [entry({ preferred_window: 'morning' }), entry({ id: 'w2', preferred_window: 'any' })];
    const out = await matchWaitlistAfterCancellation({
      clinicId: CID,
      providerId: 'p1',
      serviceId: 's1',
      cancelledDate: '2026-09-07',
      cancelledTime: '10:00', // morning
    });
    expect(out.entriesNotified).toBe(2);
  });

  it('notifies only entries matching at least one dimension', async () => {
    results.entries = [entry({ provider_id: 'p9', service_id: 's9', preferred_date: '2026-09-30', preferred_window: 'evening' })];
    const out = await matchWaitlistAfterCancellation({
      clinicId: CID,
      providerId: 'p1',
      serviceId: 's1',
      cancelledDate: '2026-09-07',
      cancelledTime: '10:00', // morning
    });
    expect(out.entriesNotified).toBe(0);
  });

  it('never throws on db error — returns 0 matched', async () => {
    results.entries = [];
    results.error = { message: 'db down' };
    const out = await matchWaitlistAfterCancellation({ clinicId: CID });
    expect(out.entriesNotified).toBe(0);
  });
});