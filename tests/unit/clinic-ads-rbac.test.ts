import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P0-closure fix — clinic ads RBAC.
 * Regression: POST /api/clinic/ads and PUT /api/clinic/ads/[adId] must be
 * admin-gated (they previously lacked roleDenied, unlike GET/DELETE). Staff,
 * receptionist and doctor roles must get 403 and never reach the DB.
 */

const CID = '11111111-1111-1111-1111-111111111111';
const AD_ID = '22222222-2222-2222-2222-222222222222';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(
    (auth: any, roles: readonly string[]) =>
      !auth.authorized ? { status: auth.status ?? 403 } : roles.includes(auth.role) ? null : { status: 403 }
  ),
  ADMIN_ROLES: ['owner', 'manager'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockDb = vi.hoisted(() => {
  const noop = () => chain;
  const chain: any = {
    select: () => chain, eq: () => chain, single: () => chain,
    insert: () => chain, update: () => chain, delete: () => chain,
    order: () => chain, then: undefined,
  };
  return { from: vi.fn(() => chain) };
});
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockDb,
}));

import { GET, POST } from '@/app/api/clinic/ads/route';
import { PUT, DELETE } from '@/app/api/clinic/ads/[adId]/route';

function req(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.from.mockClear();
});

describe('clinic ads — RBAC (P0 fix)', () => {
  it.each(['staff', 'receptionist', 'doctor'])('POST is denied for %s (was unguarded)', async (role) => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u1' } });
    const res = await POST(req(`http://localhost/api/clinic/ads?clinic_id=${CID}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'عرض' }),
    }));
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it.each(['staff', 'receptionist', 'doctor'])('PUT is denied for %s (was unguarded)', async (role) => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u1' } });
    const res = await PUT(
      req(`http://localhost/api/clinic/ads/${AD_ID}?clinic_id=${CID}`, {
        method: 'PUT',
        body: JSON.stringify({ title: 'عرض محدث' }),
      }),
      { params: { adId: AD_ID } }
    );
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it.each(['staff', 'receptionist', 'doctor'])('GET remains denied for %s', async (role) => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u1' } });
    const res = await GET(req(`http://localhost/api/clinic/ads?clinic_id=${CID}`));
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it.each(['staff', 'receptionist', 'doctor'])('DELETE remains denied for %s', async (role) => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u1' } });
    const res = await DELETE(
      req(`http://localhost/api/clinic/ads/${AD_ID}?clinic_id=${CID}`, { method: 'DELETE' }),
      { params: { adId: AD_ID } }
    );
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('unauthenticated callers are rejected with 401 (all verbs)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    expect((await POST(req(`http://localhost/api/clinic/ads?clinic_id=${CID}`, { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await PUT(req(`http://localhost/api/clinic/ads/${AD_ID}?clinic_id=${CID}`, { method: 'PUT', body: '{}' }), { params: { adId: AD_ID } })).status).toBe(401);
    expect((await DELETE(req(`http://localhost/api/clinic/ads/${AD_ID}?clinic_id=${CID}`, { method: 'DELETE' }), { params: { adId: AD_ID } })).status).toBe(401);
    expect((await GET(req(`http://localhost/api/clinic/ads?clinic_id=${CID}`))).status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});