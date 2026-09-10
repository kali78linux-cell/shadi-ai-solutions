import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 2 — API-level security + behavior tests for the new advanced-booking
// endpoints: multi-service, staff cancel (with waitlist matching), waitlist,
// activity-schedule. Covers 401 unauthenticated, 403 RBAC, cross-tenant 404,
// invalid input 400, conflicts 409.

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const state = vi.hoisted(() => ({
  appointment: {
    data: { id: 'a1', provider_id: 'p1', service_id: 's1', scheduled_at: '2026-09-07T10:00:00.000Z', status: 'scheduled' },
    error: null,
  } as any,
}));

const mockDb = vi.hoisted(() => {
  function chain(get: any) {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.update = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve(get()));
    c.then = (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return c;
  }
  const appointments = chain(() => state.appointment);
  const waitlist = chain(() => ({ data: [], error: null }));
  return {
    from: vi.fn((t: string) => (t === 'appointments' ? appointments : waitlist)),
    __appointments: appointments,
    __waitlist: waitlist,
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

// Stub the smart-scheduling + waitlist primitives the routes call (their own
// behavior is tested separately); the route-level security flows stay real.
vi.mock('@/lib/services/smartScheduling', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    bookMultiService: vi.fn(async (p: any) => ({
      plan: { clinicId: p.clinicId, providerId: p.providerId, date: p.date, feasible: true, items: [] },
      appointments: p.serviceIds.map((s: string) => ({ id: `b-${s}`, scheduled_at: 'x', serviceId: s })),
    })),
    scheduleActivityRequest: vi.fn(async (p: any) => ({
      ok: true,
      entityType: p.entityType,
      requestId: p.requestId,
      fromStatus: 'requested',
      scheduledAt: `${p.date}T${p.time}:00.000Z`,
      providerId: p.providerId,
    })),
  };
});
vi.mock('@/lib/services/waitlistService', () => ({
  addToWaitlist: vi.fn(async (p: any) => ({ id: 'w1', ...p })),
  listWaitlist: vi.fn(async () => []),
  cancelWaitlistEntry: vi.fn(async () => undefined),
  matchWaitlistAfterCancellation: vi.fn(async () => ({ entriesNotified: 1 })),
}));
vi.mock('@/lib/subscription/entitlements', () => ({
  assertEntitlement: vi.fn(async () => ({ allowed: true })),
  entitlementErrorResponse: vi.fn(() => null),
  releaseEntitlement: vi.fn(async () => undefined),
}));
vi.mock('@/lib/services/bookingService', () => ({
  findOrCreatePatient: vi.fn(async () => 'pat-1'),
}));

import { POST as multiPOST } from '@/app/api/appointments/multi/route';
import { POST as cancelPOST } from '@/app/api/appointments/cancel/route';
import { GET as waitlistGET, POST as waitlistPOST, PATCH as waitlistPATCH } from '@/app/api/appointments/waitlist/route';
import { POST as activityPOST } from '@/app/api/activity/schedule/route';

const CID = '11111111-1111-1111-1111-111111111111';
const PROVIDER = 'aaaaaaaa-1111-1111-1111-111111111111';
const SERVICE = 'bbbbbbbb-1111-1111-1111-111111111111';
const PAT = 'cccccccc-1111-1111-1111-111111111111';
const REQ = 'dddddddd-1111-1111-1111-111111111111';
const APPT = 'eeeeeeee-1111-1111-1111-111111111111';

function req(url: string, init?: RequestInit) {
  return new Request(url, init ?? { method: 'GET', headers: { 'content-type': 'application/json' } });
}

function multiBody(over: Record<string, unknown> = {}) {
  return {
    clinic_id: CID,
    provider_id: PROVIDER,
    date: '2026-09-07',
    service_ids: [SERVICE],
    patient_id: PAT,
    ...over,
  };
}

function cancelBody() {
  return { clinic_id: CID, appointment_id: APPT };
}

function activityBody(over: Record<string, unknown> = {}) {
  return {
    clinic_id: CID,
    entity_type: 'imaging_requests',
    request_id: REQ,
    provider_id: PROVIDER,
    date: '2026-09-07',
    time: '10:00',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'owner-1' }, role: 'owner' });
  mockAuth.roleDenied.mockReturnValue(null);
  state.appointment = { data: { id: APPT, provider_id: PROVIDER, service_id: SERVICE, scheduled_at: '2026-09-07T10:00:00.000Z', status: 'scheduled' }, error: null };
});

describe('PHASE 2 — multi-service security', () => {
  it('401 unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await multiPOST(req('http://localhost/api/appointments/multi', {
      method: 'POST',
      body: JSON.stringify(multiBody()),
    }));
    expect(res.status).toBe(401);
  });

  it('403 non-admin role (staff)', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await multiPOST(req('http://localhost/api/appointments/multi', {
      method: 'POST',
      body: JSON.stringify(multiBody()),
    }));
    expect(res.status).toBe(403);
  });

  it('400 invalid input (empty service list)', async () => {
    const res = await multiPOST(req('http://localhost/api/appointments/multi', {
      method: 'POST',
      body: JSON.stringify(multiBody({ service_ids: [] })),
    }));
    expect(res.status).toBe(400);
  });

  it('201 creates the multi-service booking', async () => {
    const res = await multiPOST(req('http://localhost/api/appointments/multi', {
      method: 'POST',
      body: JSON.stringify(multiBody()),
    }));
    expect(res.status).toBe(201);
  });
});

describe('PHASE 2 — staff cancel + waitlist', () => {
  it('401 unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await cancelPOST(req('http://localhost/api/appointments/cancel', {
      method: 'POST',
      body: JSON.stringify(cancelBody()),
    }));
    expect(res.status).toBe(401);
  });

  it('404 cross-tenant rejection (appointment not in this clinic)', async () => {
    state.appointment = { data: null, error: null };
    const res = await cancelPOST(req('http://localhost/api/appointments/cancel', {
      method: 'POST',
      body: JSON.stringify(cancelBody()),
    }));
    expect(res.status).toBe(404);
  });

  it('409 conflicting status (already cancelled/completed)', async () => {
    state.appointment = { data: { id: APPT, status: 'completed' }, error: null };
    const res = await cancelPOST(req('http://localhost/api/appointments/cancel', {
      method: 'POST',
      body: JSON.stringify(cancelBody()),
    }));
    expect(res.status).toBe(409);
  });

  it('200 cancels and runs waitlist matching', async () => {
    const res = await cancelPOST(req('http://localhost/api/appointments/cancel', {
      method: 'POST',
      body: JSON.stringify(cancelBody()),
    }));
    expect(res.status).toBe(200);
  });

  it('waitlist GET is RBAC-guarded; POST and PATCH succeed for owner', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const g = await waitlistGET(req(`http://localhost/api/appointments/waitlist?clinic_id=${CID}`));
    expect(g.status).toBe(403);
    const p = await waitlistPOST(req('http://localhost/api/appointments/waitlist', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: CID, contact_name: 'x', contact_phone: '0500000000' }),
    }));
    expect(p.status).toBe(201);
    const c = await waitlistPATCH(req('http://localhost/api/appointments/waitlist', {
      method: 'PATCH',
      body: JSON.stringify({ clinic_id: CID, entry_id: 'ffffffff-1111-1111-1111-111111111111' }),
    }));
    expect(c.status).toBe(200);
  });
});

describe('PHASE 2 — activity-aware scheduling API', () => {
  it('401 unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await activityPOST(req('http://localhost/api/activity/schedule', {
      method: 'POST',
      body: JSON.stringify(activityBody()),
    }));
    expect(res.status).toBe(401);
  });

  it('403 non-admin role', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await activityPOST(req('http://localhost/api/activity/schedule', {
      method: 'POST',
      body: JSON.stringify(activityBody()),
    }));
    expect(res.status).toBe(403);
  });

  it('201 schedules into a real slot (activity-aware)', async () => {
    const res = await activityPOST(req('http://localhost/api/activity/schedule', {
      method: 'POST',
      body: JSON.stringify(activityBody()),
    }));
    expect(res.status).toBe(201);
  });

  it('400 invalid time format', async () => {
    const res = await activityPOST(req('http://localhost/api/activity/schedule', {
      method: 'POST',
      body: JSON.stringify(activityBody({ time: '25:99' })),
    }));
    expect(res.status).toBe(400);
  });
});