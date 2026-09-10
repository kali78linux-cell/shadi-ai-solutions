import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  listOwnInvoices: vi.fn(),
  getOwnInvoice: vi.fn(),
  getOwnBalance: vi.fn(),
  listOwnPayments: vi.fn(),
  getOwnStatement: vi.fn(),
}));

vi.mock('@/lib/services/patientPortal', () => ({
  authorizePatientRequest: mocks.authorize,
  listOwnInvoices: mocks.listOwnInvoices,
  getOwnInvoice: mocks.getOwnInvoice,
  getOwnBalance: mocks.getOwnBalance,
  listOwnPayments: mocks.listOwnPayments,
  getOwnStatement: mocks.getOwnStatement,
  PatientPortalError: class PatientPortalError extends Error {
    code: string;
    status: number;
    constructor(code: string, status = 401) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));

import { GET as invoicesGET } from '@/app/api/portal/invoices/route';
import { GET as invoiceDetailGET } from '@/app/api/portal/invoices/[invoiceId]/route';
import { GET as balanceGET } from '@/app/api/portal/balance/route';
import { GET as paymentsGET } from '@/app/api/portal/payments/route';
import { GET as statementGET } from '@/app/api/portal/statement/route';

const IDENTITY = {
  id: 'i1',
  clinic_id: '11111111-1111-1111-1111-111111111111',
  patient_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'p@x.com',
};

function err(code: string, status: number) {
  const e = new Error(code) as Error & { code: string; status: number };
  (e as any).code = code;
  (e as any).status = status;
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PP-2 portal API — auth gating', () => {
  for (const [name, fn] of [
    ['invoices', invoicesGET],
    ['balance', balanceGET],
    ['payments', paymentsGET],
    ['statement', statementGET],
  ] as const) {
    it(`${name}: blocks unauthenticated (401) and revoked/unverified (403)`, async () => {
      mocks.authorize.mockResolvedValueOnce({ error: err('PATIENT_UNAUTHENTICATED', 401) });
      expect((await fn(new Request('http://x')).then((r) => r.status))).toBe(401);
      mocks.authorize.mockResolvedValueOnce({ error: err('NO_ACTIVE_PATIENT_IDENTITY', 403) });
      expect((await fn(new Request('http://x')).then((r) => r.status))).toBe(403);
    });
  }
});

describe('GET /api/portal/invoices', () => {
  it('returns own invoices for a valid identity (ignores client-scope params)', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.listOwnInvoices.mockResolvedValue([{ invoice_id: 'x', total: 100 }]);
    const res = await invoicesGET(new Request('http://x/invoices?patient_id=EVIL&clinic_id=EVIL'));
    expect(res.status).toBe(200);
    expect(mocks.listOwnInvoices).toHaveBeenCalledWith(IDENTITY);
  });
});

describe('GET /api/portal/invoices/[invoiceId]', () => {
  it('404 for invalid/non-uuid id and for non-owned invoice', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    let res = await invoiceDetailGET(new Request('http://x'), { params: { invoiceId: 'not-a-uuid' } });
    expect(res.status).toBe(404);
    mocks.getOwnInvoice.mockResolvedValue(null);
    res = await invoiceDetailGET(new Request('http://x'), {
      params: { invoiceId: '33333333-3333-3333-3333-333333333333' },
    });
    expect(res.status).toBe(404);
  });

  it('returns owned invoice detail only', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.getOwnInvoice.mockResolvedValue({ invoice_id: 'x', items: [] });
    const res = await invoiceDetailGET(new Request('http://x'), {
      params: { invoiceId: '33333333-3333-3333-3333-333333333333' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).invoice.items).toEqual([]);
  });
});

describe('GET /api/portal/balance & /api/portal/payments & /api/portal/statement', () => {
  it('balance returns derived values (defaults when none)', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.getOwnBalance.mockResolvedValue({ outstanding: 70, credit: 0 });
    const res = await balanceGET(new Request('http://x'));
    expect(((await res.json()) as any).balance.outstanding).toBe(70);
  });

  it('payments returns own payment history', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.listOwnPayments.mockResolvedValue([{ payment_id: 'p1' }]);
    const res = await paymentsGET(new Request('http://x'));
    expect(((await res.json()) as any).payments).toHaveLength(1);
  });

  it('statement composes invoices + payments + balance', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.getOwnStatement.mockResolvedValue({ invoices: [], payments: [], outstanding: 70, credit: 0 });
    const res = await statementGET(new Request('http://x'));
    expect(((await res.json()) as any).statement.outstanding).toBe(70);
  });

  it('fails closed to 500 on internal query failure (no leak)', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.listOwnInvoices.mockRejectedValue(new Error('boom'));
    const res = await invoicesGET(new Request('http://x'));
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).error).toBe('PORTAL_QUERY_FAILED');
  });
});