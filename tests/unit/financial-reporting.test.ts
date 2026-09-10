import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn((auth: any, _roles: readonly string[]) =>
    auth && auth.authorized === false ? { authorized: false, status: auth.status ?? 403 } : null),
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockSupabaseAdmin = vi.hoisted(() => {
  function makeBuilder(result: { data: unknown; error: unknown }) {
    const b: Record<string, any> = {};
    const CHAIN = ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'lte', 'order', 'limit', 'single', 'maybeSingle'];
    for (const m of CHAIN) b[m] = vi.fn(() => b);
    b.then = (resolve: (v: unknown) => void) => resolve(result);
    return b;
  }
  const supabaseAdmin = {
    from: vi.fn(() => makeBuilder({ data: [], error: null })),
  };
  return { supabaseAdmin, makeBuilder };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

import { getProfitAndLoss, getCashFlow, getAgingPayer } from '@/lib/services/reporting';
import { GET as getPnl } from '@/app/api/clinic/reporting/pnl/route';
import { GET as getCashFlowRoute } from '@/app/api/clinic/reporting/cash-flow/route';
import { GET as getAgingPayerRoute } from '@/app/api/clinic/reporting/aging-payer/route';

const CLINIC = '11111111-1111-1111-1111-111111111111';

function makeRequest(url: string): Request {
  return new Request(`http://localhost${url}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
});

describe('P&L (D-R1 — ledger-native, claim kinds excluded)', () => {
  it('reads financial_period_summary with tenant scoping + month range', async () => {
    const builder = mockSupabaseAdmin.makeBuilder({
      data: [{ period_month: '2026-09-01', revenue: 1000, refunds: 50, expenses: 300, bad_debt: 20, net_result: 630 }],
      error: null,
    });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);
    const rows = await getProfitAndLoss(CLINIC, { fromMonth: '2026-01-01', toMonth: '2026-12-01' });
    expect(rows[0].net_result).toBe(630); // 1000 - 50 - 300 - 20 (bad debt standalone, D-R1)
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('financial_period_summary');
    expect(builder.eq).toHaveBeenCalledWith('clinic_id', CLINIC);
    expect(builder.gte).toHaveBeenCalledWith('period_month', '2026-01-01');
  });

  it('rejects malformed month parameters before any query', async () => {
    await expect(getProfitAndLoss(CLINIC, { fromMonth: '2026-1' })).rejects.toThrow('INVALID_FROM_MONTH');
    await expect(getProfitAndLoss(CLINIC, { toMonth: 'not-a-date' })).rejects.toThrow('INVALID_TO_MONTH');
    expect(mockSupabaseAdmin.supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('never writes: P&L read issues no insert/update calls', async () => {
    const builder = mockSupabaseAdmin.makeBuilder({ data: [], error: null });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);
    await getProfitAndLoss(CLINIC);
    expect(builder.insert).not.toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
  });
});

describe('Cash Flow (D-R2 — method breakdown from source rows)', () => {
  it('reads cash_flow_summary with method filter', async () => {
    const builder = mockSupabaseAdmin.makeBuilder({
      data: [{ flow_month: '2026-09-01', method: 'cash', inflows: 500, outflows: 100, net: 400 }],
      error: null,
    });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);
    const rows = await getCashFlow(CLINIC, { method: 'cash' });
    expect(rows[0].method).toBe('cash');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('cash_flow_summary');
    expect(builder.eq).toHaveBeenCalledWith('method', 'cash');
  });

  it('rejects an unknown method param before any query', async () => {
    await expect(getCashFlow(CLINIC, { method: 'crypto' as any })).rejects.toThrow('INVALID_METHOD');
    expect(mockSupabaseAdmin.supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe('Aging payer enrichment (additive over receivable_aging)', () => {
  it('reads receivable_aging_payer with payer_type filter', async () => {
    const builder = mockSupabaseAdmin.makeBuilder({
      data: [{ invoice_number: 'INV-2026-000001', bucket: '31-60', payer_type: 'insurance', payer_name: 'Grand Insurance' }],
      error: null,
    });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);
    const rows = await getAgingPayer(CLINIC, { payerType: 'insurance', bucket: '31-60' });
    expect(rows[0].payer_name).toBe('Grand Insurance');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('receivable_aging_payer');
    expect(builder.eq).toHaveBeenCalledWith('payer_type', 'insurance');
    expect(builder.eq).toHaveBeenCalledWith('bucket', '31-60');
  });
});

describe('reporting API (D-R3 — FINANCE_READ APIs only)', () => {
  it('P&L GET → 200 for FINANCE_READ', async () => {
    const res = await getPnl(makeRequest(`/api/clinic/reporting/pnl?clinic_id=${CLINIC}`));
    expect(res.status).toBe(200);
  });

  it('P&L GET with malformed from_month → 400', async () => {
    const res = await getPnl(makeRequest(`/api/clinic/reporting/pnl?clinic_id=${CLINIC}&from_month=bad`));
    expect(res.status).toBe(400);
  });

  it('401 when unauthenticated (P&L)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await getPnl(makeRequest(`/api/clinic/reporting/pnl?clinic_id=${CLINIC}`));
    expect(res.status).toBe(401);
  });

  it('Cash Flow GET → 200', async () => {
    const res = await getCashFlowRoute(makeRequest(`/api/clinic/reporting/cash-flow?clinic_id=${CLINIC}`));
    expect(res.status).toBe(200);
  });

  it('Aging payer GET → 200', async () => {
    const res = await getAgingPayerRoute(makeRequest(`/api/clinic/reporting/aging-payer?clinic_id=${CLINIC}`));
    expect(res.status).toBe(200);
  });

  it('clinic_id missing → 400 on all three', async () => {
    expect((await getPnl(makeRequest('/api/clinic/reporting/pnl'))).status).toBe(400);
    expect((await getCashFlowRoute(makeRequest('/api/clinic/reporting/cash-flow'))).status).toBe(400);
    expect((await getAgingPayerRoute(makeRequest('/api/clinic/reporting/aging-payer'))).status).toBe(400);
  });
});
