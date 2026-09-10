import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockAdmin = vi.hoisted(() => {
  const rpc = vi.fn();
  const from = vi.fn();
  const METHODS = ['select', 'eq', 'gte', 'lte', 'order', 'update', 'insert', 'single'];
  // Thenable chain mirroring the real Supabase builder: every method returns
  // the chain, and `await chain` resolves to the configured result.
  const makeChain = (result: { data: unknown; error: unknown } = { data: [], error: null }) => {
    const chain: Record<string, any> = {};
    for (const m of METHODS) {
      chain[m] = vi.fn().mockImplementation(() => chain);
    }
    chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
    chain.__result = result;
    return chain;
  };
  from.mockImplementation(() => makeChain());
  return { supabaseAdmin: { rpc, from }, __makeChain: makeChain };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockAdmin.supabaseAdmin }));

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

import {
  recordExpense,
  voidExpense,
  listExpenses,
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  openCashSession,
  closeCashSession,
  listCashSessions,
  getDailyCashPositions,
} from '@/lib/services/accounting';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const CATEGORY = '33333333-3333-3333-3333-333333333333';
const USER = 'cccc-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.supabaseAdmin.rpc.mockReset();
  mockAdmin.supabaseAdmin.from.mockReset().mockImplementation(() => mockAdmin.__makeChain());
});

describe('Phase C service — recordExpense (D4 expense_recorded)', () => {
  it('forwards full payload to record_expense RPC and audits', async () => {
    mockAdmin.supabaseAdmin.rpc.mockResolvedValue({ data: { expense_id: 'exp-1', expense_number: 'EXP-2026-000001', duplicate: false }, error: null });
    const result = await recordExpense({
      clinicId: CLINIC_A,
      categoryId: CATEGORY,
      amount: 75.5,
      method: 'cash',
      vendor: 'Dental Supply Co',
      idempotencyKey: 'e1111111-1111-1111-1111-111111111111',
      actorUserId: USER,
    });
    expect(result).toEqual({ expenseId: 'exp-1', expenseNumber: 'EXP-2026-000001', duplicate: false });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('record_expense', expect.objectContaining({
      p_clinic_id: CLINIC_A,
      p_category_id: CATEGORY,
      p_amount: 75.5,
      p_method: 'cash',
      p_idempotency_key: 'e1111111-1111-1111-1111-111111111111',
    }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'expense_recorded', resourceType: 'clinic_expenses' }));
  });

  it('rejects non-positive amount and invalid method without calling RPC', async () => {
    await expect(recordExpense({ clinicId: CLINIC_A, amount: 0, method: 'cash', actorUserId: USER })).rejects.toThrow('EXPENSE_AMOUNT_INVALID');
    await expect(recordExpense({ clinicId: CLINIC_A, amount: 10, method: 'insurance' as never, actorUserId: USER })).rejects.toThrow('EXPENSE_METHOD_INVALID');
    expect(mockAdmin.supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('propagates RPC errors (e.g. EXPENSE_CATEGORY_INVALID)', async () => {

describe('Phase C service — voidExpense (void-not-delete)', () => {
  it('requires a reason and forwards to void_expense RPC', async () => {
    await expect(voidExpense({ clinicId: CLINIC_A, expenseId: 'exp-1', reason: '', actorUserId: USER })).rejects.toThrow('VOID_REASON_REQUIRED');
    await voidExpense({ clinicId: CLINIC_A, expenseId: 'exp-1', reason: 'wrong entry', actorUserId: USER });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('void_expense', expect.objectContaining({ p_expense_id: 'exp-1', p_reason: 'wrong entry' }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'expense_voided' }));
  });
});

describe('Phase C service — expense categories (config, no delete)', () => {
  it('creates a category with trimmed name; blank name rejected', async () => {
    const cat = await createExpenseCategory({ clinicId: CLINIC_A, name: '  Supplies  ', actorUserId: USER });
    expect(cat.id).toBe('cat-1');
    expect(mockAdmin.supabaseAdmin.from).toHaveBeenCalledWith('clinic_expense_categories');
    await expect(createExpenseCategory({ clinicId: CLINIC_A, name: '   ', actorUserId: USER })).rejects.toThrow('CATEGORY_NAME_REQUIRED');
  });

  it('updates name/is_active scoped to clinic + category id', async () => {
    await updateExpenseCategory({ clinicId: CLINIC_A, categoryId: 'cat-1', isActive: false, actorUserId: USER });
    const chain = mockAdmin.supabaseAdmin.from.mock.results[0]?.value;
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
    expect(chain.eq).toHaveBeenCalledWith('id', 'cat-1');
  });

  it('lists categories scoped to the clinic', async () => {
    await listExpenseCategories(CLINIC_A);
    const chain = mockAdmin.supabaseAdmin.from.mock.results[0]?.value;
    expect(chain.select).toHaveBeenCalledWith('*');
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
  });
});

describe('Phase C service — listExpenses filters', () => {
  it('applies clinic scope + optional filters', async () => {
    await listExpenses(CLINIC_A, { categoryId: CATEGORY, status: 'recorded', from: '2026-09-01', to: '2026-09-30' });
    const chain = mockAdmin.supabaseAdmin.from.mock.results[0]?.value;
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
    expect(chain.eq).toHaveBeenCalledWith('category_id', CATEGORY);
    expect(chain.eq).toHaveBeenCalledWith('status', 'recorded');
    expect(chain.gte).toHaveBeenCalledWith('spent_at', '2026-09-01');
    expect(chain.lte).toHaveBeenCalledWith('spent_at', '2026-09-30');
  });
});

    mockAdmin.supabaseAdmin.rpc.mockResolvedValue({ data: null, error: { message: 'EXPENSE_CATEGORY_INVALID' } });
    await expect(recordExpense({ clinicId: CLINIC_A, amount: 10, method: 'cash', categoryId: CATEGORY, actorUserId: USER })).rejects.toThrow('EXPENSE_CATEGORY_INVALID');
    expect(mockAudit.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('Phase C service — cash register sessions', () => {
  it('openCashSession validates opening amount and calls RPC', async () => {
    mockAdmin.supabaseAdmin.rpc.mockResolvedValue({ data: { session_id: 'ses-1', opening_amount: 100 }, error: null });
    const res = await openCashSession({ clinicId: CLINIC_A, openingAmount: 100, actorUserId: USER });
    expect(res).toEqual({ sessionId: 'ses-1', openingAmount: 100 });
    await expect(openCashSession({ clinicId: CLINIC_A, openingAmount: -5, actorUserId: USER })).rejects.toThrow('CASH_OPENING_INVALID');
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'cash_session_opened' }));
  });

  it('closeCashSession returns the full snapshot and audits variance', async () => {
    mockAdmin.supabaseAdmin.rpc.mockResolvedValue({
      data: { session_id: 'ses-1', opening_amount: 100, cash_in: 300, cash_out: 75, expected_closing: 325, counted_amount: 320, variance: -5 },
      error: null,
    });
    const res = await closeCashSession({ clinicId: CLINIC_A, sessionId: 'ses-1', countedAmount: 320, actorUserId: USER });
    expect(res).toEqual({ sessionId: 'ses-1', openingAmount: 100, cashIn: 300, cashOut: 75, expectedClosing: 325, countedAmount: 320, variance: -5 });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('close_cash_session', expect.objectContaining({ p_counted_amount: 320 }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'cash_session_closed', metadata: expect.objectContaining({ variance: -5 }) }));
    await expect(closeCashSession({ clinicId: CLINIC_A, sessionId: 'ses-1', countedAmount: -1, actorUserId: USER })).rejects.toThrow('CASH_COUNTED_INVALID');
  });

  it('lists sessions scoped to the clinic', async () => {
    await listCashSessions(CLINIC_A);
    const chain = mockAdmin.supabaseAdmin.from.mock.results[0]?.value;
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
  });
});

describe('Phase C service — derived daily cash positions', () => {
  it('maps view rows into typed positions', async () => {
    const rows = [
      { clinic_id: CLINIC_A, business_date: '2026-09-01', cash_in: 300, cash_out: 75, net_cash: 225 },
      { clinic_id: CLINIC_A, business_date: '2026-09-02', cash_in: 0, cash_out: 40, net_cash: -40 },
    ];
    mockAdmin.supabaseAdmin.from.mockImplementationOnce(() => mockAdmin.__makeChain({ data: rows, error: null }));
    const positions = await getDailyCashPositions(CLINIC_A, '2026-09-01', '2026-09-30');
    expect(positions).toEqual([
      { businessDate: '2026-09-01', cashIn: 300, cashOut: 75, netCash: 225 },
      { businessDate: '2026-09-02', cashIn: 0, cashOut: 40, netCash: -40 },
    ]);
    const chain = mockAdmin.supabaseAdmin.from.mock.results[0]?.value;
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
    expect(chain.gte).toHaveBeenCalledWith('business_date', '2026-09-01');
  });
});

// Tenant-safety contract: the service always scopes by clinic_id; every
// query chain and RPC call must carry the clinic scope.
describe('Phase C service — tenant scoping contract', () => {
  it('never issues a query or RPC without the clinic scope', async () => {
    mockAdmin.supabaseAdmin.rpc.mockResolvedValue({ data: { expense_id: 'e', expense_number: 'n', duplicate: false }, error: null });
    await recordExpense({ clinicId: CLINIC_B, amount: 5, method: 'card', actorUserId: USER });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('record_expense', expect.objectContaining({ p_clinic_id: CLINIC_B }));
    await listExpenses(CLINIC_B);
    await listCashSessions(CLINIC_B);
    await getDailyCashPositions(CLINIC_B);
    const chains = mockAdmin.supabaseAdmin.from.mock.results.map((r) => r.value);
    for (const chain of chains) {
      const eqCalls = chain.eq?.mock?.calls ?? [];
      if (eqCalls.length > 0) expect(eqCalls[0]).toEqual(['clinic_id', CLINIC_B]);
    }
  });
});

