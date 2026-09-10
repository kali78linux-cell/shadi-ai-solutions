import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PP-5 — Financial Intelligence API route tests (RBAC + shape).
 * Separate file from the service tests so the service module can be mocked
 * here without shadowing the real implementation used there.
 */

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn((auth: any, _roles: readonly string[]) =>
    auth && auth.authorized === false ? { status: auth.status ?? 403 } : null),
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockFI = vi.hoisted(() => ({ getFinancialIntelligence: vi.fn() }));
vi.mock('@/lib/services/financialIntelligence', () => mockFI);

import { GET } from '@/app/api/clinic/financial-intelligence/route';

const req = (clinicId = 'c1') =>
  new Request(`http://localhost/api/clinic/financial-intelligence?clinic_id=${clinicId}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true });
});

describe('PP-5 API route — RBAC and shape', () => {
  it('400 when clinic_id missing', async () => {
    const res = await GET(new Request('http://localhost/api/clinic/financial-intelligence'));
    expect(res.status).toBe(400);
    expect(mockAuth.authorizeClinicRequest).not.toHaveBeenCalled();
  });

  it('401 for unauthenticated callers (no data exposure)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockFI.getFinancialIntelligence).not.toHaveBeenCalled();
  });

  it('403 for unauthorized actors — patient portal roles cannot read FI', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockFI.getFinancialIntelligence).not.toHaveBeenCalled();
    expect(mockAuth.roleDenied).toHaveBeenCalledWith(expect.anything(), mockAuth.FINANCE_READ_ROLES);
  });

  it('200 with derived data for an authorized finance role; clinic_id passed through untouched', async () => {
    mockFI.getFinancialIntelligence.mockResolvedValue({ kpis: { revenue: 1 } });
    const res = await GET(req('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kpis.revenue).toBe(1);
    expect(mockFI.getFinancialIntelligence).toHaveBeenCalledWith('c1', { fromMonth: undefined, toMonth: undefined });
  });

  it('forwards from_month/to_month query params', async () => {
    mockFI.getFinancialIntelligence.mockResolvedValue({});
    await GET(new Request('http://localhost/api/clinic/financial-intelligence?clinic_id=c1&from_month=2026-01-01&to_month=2026-03-01'));
    expect(mockFI.getFinancialIntelligence).toHaveBeenCalledWith('c1', { fromMonth: '2026-01-01', toMonth: '2026-03-01' });
  });

  it('400 on INVALID_ month errors, 500 otherwise (no stack leakage)', async () => {
    mockFI.getFinancialIntelligence.mockRejectedValue(new Error('INVALID_FROM_MONTH'));
    expect((await GET(req())).status).toBe(400);
    mockFI.getFinancialIntelligence.mockRejectedValue(new Error('boom'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('boom');
  });
});
