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
  getInvoiceDetail: vi.fn(),
  voidInvoice: vi.fn(),
  recordPayment: vi.fn(),
  listPayments: vi.fn(),
  voidPayment: vi.fn(),
  refundPayment: vi.fn(),
  getPatientBalances: vi.fn(),
}));
vi.mock('@/lib/services/accounting', () => mockAccounting);

import { GET as getInvoices, POST as postInvoice } from '@/app/api/clinic/accounting/invoices/route';
import { GET as getInvoiceDetail } from '@/app/api/clinic/accounting/invoices/[invoiceId]/route';
import { POST as postVoidInvoice } from '@/app/api/clinic/accounting/invoices/[invoiceId]/void/route';
import { GET as getPayments, POST as postPayment } from '@/app/api/clinic/accounting/payments/route';
import { POST as postVoidPayment } from '@/app/api/clinic/accounting/payments/[paymentId]/void/route';
import { POST as postRefund } from '@/app/api/clinic/accounting/payments/[paymentId]/refund/route';
import { GET as getBalances } from '@/app/api/clinic/accounting/balances/route';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const USER = 'cccc-1111-1111-1111-111111111111';

const BASE = 'https://test.local';
function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`${BASE}${url}`, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

// Real-feeling roleDenied so RBAC is tested against the declared matrices.
mockAuth.roleDenied.mockImplementation((authorization: any, roles: readonly string[]) => {
  if (!authorization?.authorized) return { authorized: false, status: authorization?.status === 401 ? 401 : 403 };
  if (!roles.includes(authorization.role)) return { authorized: false, status: 403 };
  return null;
});

beforeEach(() => {
  vi.clearAllMocks();
describe('accounting API — RBAC (finance matrices)', () => {
  it('owner can issue an invoice → 201', async () => {
    const res = await postInvoice(makeRequest('/api/clinic/accounting/invoices', jsonBody({ clinic_id: CLINIC_A, patient_id: 'p1', items: [{ description: 'x', quantity: 1, unit_price: 10 }] })));
    expect(res.status).toBe(201);
    expect(mockAccounting.issueInvoice).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A }));
  });

  it('doctor (outside INVOICE_CREATE_ROLES) → 403', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'doctor' });
    const res = await postInvoice(makeRequest('/api/clinic/accounting/invoices', jsonBody({ clinic_id: CLINIC_A, patient_id: 'p1', items: [] })));
    expect(res.status).toBe(403);
    expect(mockAccounting.issueInvoice).not.toHaveBeenCalled();
  });

  it('receptionist can record a payment but cannot void (admin-only)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const payRes = await postPayment(makeRequest('/api/clinic/accounting/payments', jsonBody({ clinic_id: CLINIC_A, invoice_id: 'inv-1', amount: 50, method: 'cash' })));
    expect(payRes.status).toBe(201);

    const voidRes = await postVoidPayment(makeRequest(`/api/clinic/accounting/payments/pay-1/void?clinic_id=${CLINIC_A}`, jsonBody({ reason: 'x' })), { params: Promise.resolve({ paymentId: 'pay-1' }) } as any);
    expect(voidRes.status).toBe(403);
    expect(mockAccounting.voidPayment).not.toHaveBeenCalled();
  });

  it('manager can read finance summaries but cannot refund', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'manager' });
    const readRes = await getInvoices(makeRequest(`/api/clinic/accounting/invoices?clinic_id=${CLINIC_A}`));
    expect(readRes.status).toBe(200);

    const refundRes = await postRefund(makeRequest(`/api/clinic/accounting/payments/pay-1/refund?clinic_id=${CLINIC_A}`, jsonBody({ amount: 10, reason: 'r' })), { params: Promise.resolve({ paymentId: 'pay-1' }) } as any);
    expect(refundRes.status).toBe(403);
  });

  it('accountant can void invoice and refund', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'accountant' });
    const voidRes = await postVoidInvoice(makeRequest(`/api/clinic/accounting/invoices/inv-1/void?clinic_id=${CLINIC_A}`, jsonBody({ reason: 'duplicate' })), { params: Promise.resolve({ invoiceId: 'inv-1' }) } as any);
    expect(voidRes.status).toBe(200);
    const refundRes = await postRefund(makeRequest(`/api/clinic/accounting/payments/pay-1/refund?clinic_id=${CLINIC_A}`, jsonBody({ amount: 5, reason: 'r' })), { params: Promise.resolve({ paymentId: 'pay-1' }) } as any);
    expect(refundRes.status).toBe(201);
  });
});
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'owner' });
  mockAccounting.issueInvoice.mockResolvedValue({ invoiceId: 'inv-1', invoiceNumber: 'INV-2026-000001' });
  mockAccounting.recordPayment.mockResolvedValue({ paymentId: 'pay-1', receiptNumber: 'RCP-2026-000001' });
  mockAccounting.refundPayment.mockResolvedValue({ refundPaymentId: 'refund-1' });
  mockAccounting.listInvoices.mockResolvedValue([]);
  mockAccounting.getInvoiceDetail.mockResolvedValue({ id: 'inv-1', items: [], payments: [] });
  mockAccounting.listPayments.mockResolvedValue([]);
  mockAccounting.getPatientBalances.mockResolvedValue([]);
  mockAccounting.voidInvoice.mockResolvedValue(undefined);
  mockAccounting.voidPayment.mockResolvedValue(undefined);
});
describe('accounting API — tenant isolation', () => {
  it('unauthenticated/unauthorized → 401 (not 403, not data)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    mockAuth.roleDenied.mockImplementationOnce((_authorization: any, _roles: readonly string[]) => ({ authorized: false, status: _authorization.status ?? 401 }));
    const res = await getBalances(makeRequest(`/api/clinic/accounting/balances?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(401);
    expect(mockAccounting.getPatientBalances).not.toHaveBeenCalled();
  });

  it('member of clinic B cannot read clinic A balances → 403', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'owner' });
    mockAuth.roleDenied.mockImplementationOnce((_authorization: any, _roles: readonly string[]) => ({ authorized: false, status: 403 }));
    const res = await getBalances(makeRequest(`/api/clinic/accounting/balances?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(403);
    expect(mockAccounting.getPatientBalances).not.toHaveBeenCalled();
  });

  it('service calls always receive the exact clinicId from the request (no leakage)', async () => {
    const res = await getInvoices(makeRequest(`/api/clinic/accounting/invoices?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(200);
    expect(mockAccounting.listInvoices).toHaveBeenCalledWith(CLINIC_A, null);
  });
});

describe('accounting API — validation surface', () => {
  it('POST payments with missing clinic_id → 400', async () => {
    const res = await postPayment(makeRequest('/api/clinic/accounting/payments', jsonBody({ invoice_id: 'inv-1', amount: 1, method: 'cash' })));
    expect(res.status).toBe(400);
  });

  it('GET balances without clinic_id → 400', async () => {
    const res = await getBalances(makeRequest('/api/clinic/accounting/balances'));
    expect(res.status).toBe(400);
  });

  it('invoice detail for unknown invoice → 404', async () => {
    mockAccounting.getInvoiceDetail.mockResolvedValue(null);
    const res = await getInvoiceDetail(makeRequest(`/api/clinic/accounting/invoices/nope?clinic_id=${CLINIC_A}`), { params: Promise.resolve({ invoiceId: 'nope' }) } as any);
    expect(res.status).toBe(404);
  });
});