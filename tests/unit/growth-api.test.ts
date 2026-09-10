import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  createRecallRule: vi.fn(),
  listRecallRules: vi.fn(),
  updateRecallRule: vi.fn(),
  deleteRecallRule: vi.fn(),
  listRecalls: vi.fn(),
  dismissRecall: vi.fn(),
  addWaitlistEntry: vi.fn(),
  listWaitlistEntries: vi.fn(),
  cancelWaitlistEntry: vi.fn(),
  matchWaitlistForReleasedSlot: vi.fn(),
}));

vi.mock('@/lib/services/clinicAuthorization', () => ({
  authorizeClinicRequest: mocks.authorizeClinicRequest,
  roleDenied: (auth: any, allowed: readonly string[]) => {
    if (!auth.authorized) return { authorized: false, status: auth.status ?? 401 };
    if (!allowed.includes(auth.role ?? '')) return { authorized: false, status: 403 };
    return null;
  },
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
  FINANCE_ADMIN_ROLES: ['owner', 'accountant'],
}));

vi.mock('@/lib/services/growth', () => ({
  createRecallRule: mocks.createRecallRule,
  listRecallRules: mocks.listRecallRules,
  updateRecallRule: mocks.updateRecallRule,
  deleteRecallRule: mocks.deleteRecallRule,
  listRecalls: mocks.listRecalls,
  dismissRecall: mocks.dismissRecall,
  addWaitlistEntry: mocks.addWaitlistEntry,
  listWaitlistEntries: mocks.listWaitlistEntries,
  cancelWaitlistEntry: mocks.cancelWaitlistEntry,
  matchWaitlistForReleasedSlot: mocks.matchWaitlistForReleasedSlot,
}));

import { POST as recallRulesPOST, GET as recallRulesGET } from '@/app/api/clinic/growth/recall-rules/route';
import { PATCH as rulePATCH, DELETE as ruleDELETE } from '@/app/api/clinic/growth/recall-rules/[ruleId]/route';
import { GET as recallsGET } from '@/app/api/clinic/growth/recalls/route';
import { POST as recallDismissPOST } from '@/app/api/clinic/growth/recalls/[recallId]/dismiss/route';
import { POST as waitlistPOST, GET as waitlistGET } from '@/app/api/clinic/growth/waitlist/route';
import { POST as matchPOST } from '@/app/api/clinic/growth/waitlist/match/route';

const CLINIC = '11111111-1111-1111-1111-111111111111';

function authed(role = 'owner') {
  mocks.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'uuuu' } });
}
function unauthed() {
  mocks.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401, role: null });
}
function forbidden(role = 'doctor') {
  mocks.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'uuuu' } });
}

function jsonBody(obj: unknown) {
  return new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
}
function getReq(params: Record<string, string>) {
  const sp = new URLSearchParams(params).toString();
  return new Request('http://localhost?' + sp, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  authed();
});

describe('growth recall-rules API', () => {
  it('POST creates rule (owner)', async () => {
    mocks.createRecallRule.mockResolvedValue({ id: 'r1' });
    const res = await recallRulesPOST(jsonBody({ clinic_id: CLINIC, service_id: null, recall_after_days: 30 }));
    expect(res.status).toBe(201);
    expect(mocks.createRecallRule).toHaveBeenCalledWith(expect.objectContaining({ recallAfterDays: 30 }));
  });

  it('POST rejects invalid days', async () => {
    const res = await recallRulesPOST(jsonBody({ clinic_id: CLINIC, service_id: null, recall_after_days: 5000 }));
    expect(res.status).toBe(400);
    expect(mocks.createRecallRule).not.toHaveBeenCalled();
  });

  it('POST 401 unauthenticated', async () => {
    unauthed();
    const res = await recallRulesPOST(jsonBody({ clinic_id: CLINIC, service_id: null, recall_after_days: 30 }));
    expect(res.status).toBe(401);
  });

  it('PATCH blocked for non-admin (receptionist)', async () => {
    forbidden('receptionist');
    const res = await rulePATCH(jsonBody({ clinic_id: CLINIC, enabled: false }), { params: { ruleId: 'r1' } } as any);
    expect(res.status).toBe(403);
  });

  it('DELETE removes rule (owner)', async () => {
    mocks.deleteRecallRule.mockResolvedValue(undefined);
    const res = await ruleDELETE(getReq({ clinic_id: CLINIC }), { params: { ruleId: 'r1' } } as any);
    expect(res.status).toBe(200);
  });
});

describe('recalls API', () => {
  it('GET lists recalls with status filter', async () => {
    mocks.listRecalls.mockResolvedValue([{ id: 'rr' }]);
    const res = await recallsGET(getReq({ clinic_id: CLINIC, status: 'open' }));
    expect(res.status).toBe(200);
    expect(mocks.listRecalls).toHaveBeenCalledWith(CLINIC, 'open');
  });

  it('dismiss requires auth', async () => {
    unauthed();
    const res = await recallDismissPOST(jsonBody({ clinic_id: CLINIC }), { params: { recallId: 'rr' } } as any);
    expect(res.status).toBe(401);
  });

  it('dismiss succeeds for staff', async () => {
    authed('receptionist');
    mocks.dismissRecall.mockResolvedValue(undefined);
    const res = await recallDismissPOST(jsonBody({ clinic_id: CLINIC }), { params: { recallId: 'rr' } } as any);
    expect(res.status).toBe(200);
  });
});

describe('waitlist API', () => {
  it('POST creates entry without provider/service', async () => {
    mocks.addWaitlistEntry.mockResolvedValue({ id: 'w1' });
    const res = await waitlistPOST(jsonBody({ clinic_id: CLINIC, patient_id: '22222222-2222-2222-2222-222222222222', expires_at: '2026-09-30T00:00:00Z' }));
    expect(res.status).toBe(201);
  });

  it('GET lists entries', async () => {
    mocks.listWaitlistEntries.mockResolvedValue([]);
    const res = await waitlistGET(getReq({ clinic_id: CLINIC }));
    expect(res.status).toBe(200);
  });

  it('POST match requires FINANCE_ADMIN', async () => {
    forbidden('receptionist');
    const res = await matchPOST(jsonBody({ clinic_id: CLINIC, appointment_id: '33333333-3333-3333-3333-333333333333', provider_id: '55555555-5555-5555-5555-555555555555', released_at: '2026-09-05T10:00:00Z' }));
    expect(res.status).toBe(403);
  });

  it('POST match succeeds for owner', async () => {
    mocks.matchWaitlistForReleasedSlot.mockResolvedValue({ id: 'w1' });
    const res = await matchPOST(jsonBody({ clinic_id: CLINIC, appointment_id: '33333333-3333-3333-3333-333333333333', provider_id: '55555555-5555-5555-5555-555555555555', released_at: '2026-09-05T10:00:00Z' }));
    expect(res.status).toBe(200);
    expect(mocks.matchWaitlistForReleasedSlot).toHaveBeenCalled();
  });
});
