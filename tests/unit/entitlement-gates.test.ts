import { describe, it, expect, vi, beforeEach } from 'vitest';

// STEP 15C — route-level gate proof (members POST, resource "users"):
// blocked at the limit → HTTP 402 upgrade_required; failed inserts → compensating release.

const mockEnt = vi.hoisted(() => ({
  assertEntitlement: vi.fn(),
  releaseEntitlement: vi.fn(),
}));

vi.mock('@/lib/subscription/entitlements', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertEntitlement: mockEnt.assertEntitlement,
    releaseEntitlement: mockEnt.releaseEntitlement,
  };
});

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

vi.mock('@/lib/services/auditService', () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const mockDb = vi.hoisted(() => {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => ({ data: null, error: null }));
  const single = vi.fn(() => ({ data: { id: 'cu-1', user_id: 'u9', role: 'staff', is_active: true }, error: null }));
  chain.insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  return {
    from: vi.fn(() => chain),
    __single: single,
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users: [{ id: 'u9', email: 'newdoc@example.com' }] } })),
      },
    },
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));

import { EntitlementLimitError } from '@/lib/subscription/entitlements';
import { POST } from '@/app/api/clinic/members/route';

const CID = '11111111-1111-1111-1111-111111111111';

function makeReq(body: unknown) {
  return new Request(`http://localhost/api/clinic/members?clinic_id=${CID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('STEP 15C — members POST users gate (server-side, after authorization)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.authorizeClinicRequest.mockResolvedValue({
      authorized: true,
      user: { id: 'owner-1' },
      role: 'owner',
    });
    mockDb.__single.mockImplementation(() => ({
      data: { id: 'cu-1', user_id: 'u9', role: 'staff', is_active: true },
      error: null,
    }));
  });

  it('blocks the 3rd member with 402 ENTITLEMENT_LIMIT_REACHED and writes nothing', async () => {
    mockEnt.assertEntitlement.mockRejectedValueOnce(new EntitlementLimitError('users', 2, 2));
    const res = await POST(makeReq({ email: 'newdoc@example.com', role: 'staff' }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toEqual({ error: 'ENTITLEMENT_LIMIT_REACHED', resource: 'users', upgrade_required: true });
    expect(mockEnt.assertEntitlement).toHaveBeenCalledWith(CID, 'users');
    // Gate sits before the guarded write — no membership row was inserted.
    expect(mockDb.from).not.toHaveBeenCalledWith('audit_logs');
  });

  it('proceeds to the insert when the gate allows', async () => {
    mockEnt.assertEntitlement.mockResolvedValueOnce({ allowed: true, limit: 2, used: 1 });
    const res = await POST(makeReq({ email: 'newdoc@example.com', role: 'staff' }));
    expect(res.status).toBe(201);
  });

  it('releases the counter when the guarded insert fails', async () => {
    mockEnt.assertEntitlement.mockResolvedValueOnce({ allowed: true, limit: 2, used: 2 });
    mockDb.__single.mockImplementationOnce(() => ({ data: null, error: { message: 'insert failed' } }));
    const res = await POST(makeReq({ email: 'newdoc@example.com', role: 'staff' }));
    expect(res.status).toBe(500);
    expect(mockEnt.releaseEntitlement).toHaveBeenCalledWith(CID, 'users');
  });
});
