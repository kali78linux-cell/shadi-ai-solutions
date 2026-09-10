import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(),
  INVOICE_CREATE_ROLES: ['owner', 'accountant', 'receptionist'],
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
  PAYMENT_RECORD_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
  FINANCE_ADMIN_ROLES: ['owner', 'accountant'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockAccounting = vi.hoisted(() => ({
  issueInvoice: vi.fn(),
  listInvoices: vi.fn(),
  recordWriteOff: vi.fn(),
  listWriteOffs: vi.fn(),
  getAgingSummary: vi.fn(),
}));
vi.mock('@/lib/services/accounting', () => mockAccounting);

import { POST as postInvoice } from '@/app/api/clinic/accounting/invoices/route';
import { POST as postWriteOff, GET as getWriteOffs } from '@/app/api/clinic/accounting/adjustments/route';
import { GET as getAging } from '@/app/api/clinic/accounting/aging/route';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const USER = 'cccc-1111-1111-1111-111111111111';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`https://test.local${url}`, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

// Real-feeling roleDenied so every RBAC matrix is exercised as declared.
mockAuth.roleDenied.mockImplementation((authorization: any, roles: readonly string[]) => {
  if (!authorization?.authorized) return { authorized: false, status: authorization?.status === 401 ? 401 : 403 };
  if (!roles.includes(authorization.role)) return { authorized: false, status: 403 };
  return null;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockReset();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'owner' });
  mockAccounting.issueInvoice.mockReset();
  mockAccounting.issueInvoice.mockResolvedValue({ invoiceId: 'inv-1', invoiceNumber: 'INV-2026-000001' });
  mockAccounting.recordWriteOff.mockReset();
  mockAccounting.recordWriteOff.mockResolvedValue({ adjustmentId: 'adj-1', amount: 10, availableBefore: 20, remaining: 10 });
  mockAccounting.listWriteOffs.mockReset();
  mockAccounting.listWriteOffs.mockResolvedValue([]);
  mockAccounting.getAgingSummary.mockReset();
  mockAccounting.getAgingSummary.mockResolvedValue({ buckets: [], totalOutstanding: 0, rows: [] });
});

describe('Phase B API — write-off (D-B2) RBAC', () => {
  it('owner can record a write-off → 201', async () => {
    const res = await postWriteOff(makeRequest('/api/clinic/accounting/adjustments', jsonBody({ clinic_id: CLINIC_A, invoice_id: 'inv-1', amount: 10, reason: 'uncollectible' })));
    expect(res.status).toBe(201);
    expect(mockAccounting.recordWriteOff).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 10 }));
  });

  it('accountant can record a write-off → 201', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'accountant' });
    const res = await postWriteOff(makeRequest('/api/clinic/accounting/adjustments', jsonBody({ clinic_id: CLINIC_A, invoice_id: 'inv-1', amount: 5, reason: 'x' })));
    expect(res.status).toBe(201);
  });

  it('receptionist (outside FINANCE_ADMIN_ROLES) → 403, service not called', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const res = await postWriteOff(makeRequest('/api/clinic/accounting/adjustments', jsonBody({ clinic_id: CLINIC_A, invoice_id: 'inv-1', amount: 5, reason: 'x' })));
    expect(res.status).toBe(403);
    expect(mockAccounting.recordWriteOff).not.toHaveBeenCalled();
  });

  it('missing clinic_id → 400', async () => {
    const res = await postWriteOff(makeRequest('/api/clinic/accounting/adjustments', jsonBody({ invoice_id: 'inv-1', amount: 5, reason: 'x' })));
    expect(res.status).toBe(400);
  });
});

describe('Phase B API — discount authorization (D-B3)', () => {
  it('receptionist issuing an invoice with discount > 0 → 403 DISCOUNT_AUTHORIZATION_REQUIRED', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const res = await postInvoice(makeRequest('/api/clinic/accounting/invoices', jsonBody({ clinic_id: CLINIC_A, patient_id: 'p1', items: [{ description: 'x', quantity: 1, unit_price: 100 }], discount: 50 })));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('DISCOUNT_AUTHORIZATION_REQUIRED');
    expect(mockAccounting.issueInvoice).not.toHaveBeenCalled();
  });

  it('receptionist WITHOUT discount stays allowed (INVOICE_CREATE_ROLES) → 201', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const res = await postInvoice(makeRequest('/api/clinic/accounting/invoices', jsonBody({ clinic_id: CLINIC_A, patient_id: 'p1', items: [{ description: 'x', quantity: 1, unit_price: 100 }] })));
    expect(res.status).toBe(201);
  });

  it('accountant (FINANCE_ADMIN) may discount → 201', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'accountant' });
    const res = await postInvoice(makeRequest('/api/clinic/accounting/invoices', jsonBody({ clinic_id: CLINIC_A, patient_id: 'p1', items: [{ description: 'x', quantity: 1, unit_price: 100 }], discount: 30 })));
    expect(res.status).toBe(201);
    expect(mockAccounting.issueInvoice).toHaveBeenCalledWith(expect.objectContaining({ discount: 30 }));
  });
});

describe('Phase B API — aging (D-B5) reads + tenant isolation', () => {
  it('owner reads aging → 200 with exact clinic passthrough', async () => {
    const res = await getAging(makeRequest(`/api/clinic/accounting/aging?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(200);
    expect(mockAccounting.getAgingSummary).toHaveBeenCalledWith(CLINIC_A, null);
  });

  it('doctor (outside FINANCE_READ_ROLES) → 403', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'doctor' });
    const res = await getAging(makeRequest(`/api/clinic/accounting/aging?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(403);
    expect(mockAccounting.getAgingSummary).not.toHaveBeenCalled();
  });

  it('unauthenticated (no membership) → 401, no data leaked', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await getAging(makeRequest(`/api/clinic/accounting/aging?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(401);
    expect(mockAccounting.getAgingSummary).not.toHaveBeenCalled();
  });

  it('list write-offs is finance-read scoped and never crosses tenants', async () => {
    const res = await getWriteOffs(makeRequest(`/api/clinic/accounting/adjustments?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(200);
    expect(mockAccounting.listWriteOffs).toHaveBeenCalledWith(CLINIC_A, null);
  });
});