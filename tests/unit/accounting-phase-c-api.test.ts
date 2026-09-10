import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(),
  EXPENSE_RECORD_ROLES: ['owner', 'accountant', 'manager'],
  EXPENSE_CATEGORY_MANAGE_ROLES: ['owner', 'accountant', 'manager'],
  CASH_SESSION_OPEN_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
  CASH_SESSION_CLOSE_ROLES: ['owner', 'accountant'],
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
  FINANCE_ADMIN_ROLES: ['owner', 'accountant'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockAccounting = vi.hoisted(() => ({
  recordExpense: vi.fn(),
  voidExpense: vi.fn(),
  listExpenses: vi.fn(),
  listExpenseCategories: vi.fn(),
  createExpenseCategory: vi.fn(),
  updateExpenseCategory: vi.fn(),
  openCashSession: vi.fn(),
  closeCashSession: vi.fn(),
  listCashSessions: vi.fn(),
  getDailyCashPositions: vi.fn(),
}));
vi.mock('@/lib/services/accounting', () => mockAccounting);

import { POST as postExpense, GET as getExpenses } from '@/app/api/clinic/accounting/expenses/route';
import { POST as postExpenseVoid } from '@/app/api/clinic/accounting/expenses/[expenseId]/void/route';
import { POST as postCategory, GET as getCategories } from '@/app/api/clinic/accounting/expense-categories/route';
import { PATCH as patchCategory } from '@/app/api/clinic/accounting/expense-categories/[categoryId]/route';
import { POST as openSession, GET as getSessions } from '@/app/api/clinic/accounting/cash/sessions/route';
import { POST as closeSession } from '@/app/api/clinic/accounting/cash/sessions/[sessionId]/close/route';
import { GET as getDaily } from '@/app/api/clinic/accounting/cash/daily/route';

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
  mockAccounting.recordExpense.mockReset().mockResolvedValue({ expenseId: 'exp-1', expenseNumber: 'EXP-2026-000001', duplicate: false });
  mockAccounting.voidExpense.mockReset().mockResolvedValue(undefined);
  mockAccounting.listExpenses.mockReset().mockResolvedValue([]);
  mockAccounting.listExpenseCategories.mockReset().mockResolvedValue([]);
  mockAccounting.createExpenseCategory.mockReset().mockResolvedValue({ id: 'cat-1', name: 'Supplies' });
  mockAccounting.updateExpenseCategory.mockReset().mockResolvedValue({ id: 'cat-1', name: 'Supplies', is_active: false });
  mockAccounting.openCashSession.mockReset().mockResolvedValue({ sessionId: 'ses-1', openingAmount: 100 });
  mockAccounting.closeCashSession.mockReset().mockResolvedValue({ sessionId: 'ses-1', openingAmount: 100, cashIn: 300, cashOut: 75, expectedClosing: 325, countedAmount: 320, variance: -5 });
  mockAccounting.listCashSessions.mockReset().mockResolvedValue([]);
  mockAccounting.getDailyCashPositions.mockReset().mockResolvedValue([]);
});

describe('Phase C API — expenses RBAC (EXPENSE_RECORD_ROLES)', () => {
  it('owner can record an expense → 201', async () => {
    const res = await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ clinic_id: CLINIC_A, amount: 75.5, method: 'cash', vendor: 'Supply Co' })));
    expect(res.status).toBe(201);
    expect(mockAccounting.recordExpense).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A, amount: 75.5, method: 'cash' }));
  });

  it('manager can record an expense → 201', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'manager' });
    const res = await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ clinic_id: CLINIC_A, amount: 20, method: 'card' })));
    expect(res.status).toBe(201);
  });

  it('receptionist (outside EXPENSE_RECORD_ROLES) → 403, service not called', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const res = await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ clinic_id: CLINIC_A, amount: 20, method: 'cash' })));
    expect(res.status).toBe(403);
    expect(mockAccounting.recordExpense).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ clinic_id: CLINIC_A, amount: 20, method: 'cash' })));
    expect(res.status).toBe(401);
  });

  it('missing clinic_id → 400', async () => {
    const res = await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ amount: 20, method: 'cash' })));
    expect(res.status).toBe(400);
  });

  it('domain error (EXPENSE_CATEGORY_INVALID) → 400', async () => {
    mockAccounting.recordExpense.mockRejectedValueOnce(new Error('EXPENSE_CATEGORY_INVALID'));
    const res = await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ clinic_id: CLINIC_A, amount: 20, method: 'cash', category_id: 'x' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('EXPENSE_CATEGORY_INVALID');
  });

  it('GET list requires FINANCE_READ_ROLES', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'doctor' });
    const denied = await getExpenses(makeRequest(`/api/clinic/accounting/expenses?clinic_id=${CLINIC_A}`));
    expect(denied.status).toBe(403);
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'owner' });
    const ok = await getExpenses(makeRequest(`/api/clinic/accounting/expenses?clinic_id=${CLINIC_A}`));
    expect(ok.status).toBe(200);
  });
});

describe('Phase C API — expense void (FINANCE_ADMIN only)', () => {
  const voidRequest = (clinic = CLINIC_A) =>
    makeRequest(`/api/clinic/accounting/expenses/exp-1/void?clinic_id=${clinic}`, jsonBody({ reason: 'wrong entry' }));
  const routeParams = { params: Promise.resolve({ expenseId: 'exp-1' }) };

  it('owner can void → 200', async () => {
    const res = await postExpenseVoid(voidRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockAccounting.voidExpense).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A, expenseId: 'exp-1' }));
  });

  it('manager (outside FINANCE_ADMIN_ROLES) → 403', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'manager' });
    const res = await postExpenseVoid(voidRequest(), routeParams);
    expect(res.status).toBe(403);
    expect(mockAccounting.voidExpense).not.toHaveBeenCalled();
  });

  it('EXPENSE_NOT_FOUND → 404', async () => {
    mockAccounting.voidExpense.mockRejectedValueOnce(new Error('EXPENSE_NOT_FOUND'));
    const res = await postExpenseVoid(voidRequest(), routeParams);
    expect(res.status).toBe(404);
  });
});


describe('Phase C API — expense categories', () => {
  it('create requires EXPENSE_CATEGORY_MANAGE_ROLES', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const denied = await postCategory(makeRequest('/api/clinic/accounting/expense-categories', jsonBody({ clinic_id: CLINIC_A, name: 'X' })));
    expect(denied.status).toBe(403);
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'owner' });
    const ok = await postCategory(makeRequest('/api/clinic/accounting/expense-categories', jsonBody({ clinic_id: CLINIC_A, name: 'Supplies' })));
    expect(ok.status).toBe(201);
  });

  it('PATCH rename/deactivate requires the same gate', async () => {
    const res = await patchCategory(
      makeRequest(`/api/clinic/accounting/expense-categories/cat-1?clinic_id=${CLINIC_A}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      }),
      { params: Promise.resolve({ categoryId: 'cat-1' }) }
    );
    expect(res.status).toBe(200);
    expect(mockAccounting.updateExpenseCategory).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A, categoryId: 'cat-1', isActive: false }));
  });

  it('GET list is FINANCE_READ', async () => {
    const res = await getCategories(makeRequest(`/api/clinic/accounting/expense-categories?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(200);
  });
});

describe('Phase C API — cash register sessions', () => {
  it('receptionist can OPEN a session (CASH_SESSION_OPEN_ROLES) → 201', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'receptionist' });
    const res = await openSession(makeRequest('/api/clinic/accounting/cash/sessions', jsonBody({ clinic_id: CLINIC_A, opening_amount: 100 })));
    expect(res.status).toBe(201);
    expect(mockAccounting.openCashSession).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A, openingAmount: 100 }));
  });

  it('second open while a session is open → 409', async () => {
    mockAccounting.openCashSession.mockRejectedValueOnce(new Error('CASH_SESSION_ALREADY_OPEN'));
    const res = await openSession(makeRequest('/api/clinic/accounting/cash/sessions', jsonBody({ clinic_id: CLINIC_A, opening_amount: 0 })));
    expect(res.status).toBe(409);
  });

  it('manager (outside CASH_SESSION_CLOSE_ROLES) cannot CLOSE → 403', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'manager' });
    const res = await closeSession(
      makeRequest(`/api/clinic/accounting/cash/sessions/ses-1/close?clinic_id=${CLINIC_A}`, jsonBody({ counted_amount: 320 })),
      { params: Promise.resolve({ sessionId: 'ses-1' }) }
    );
    expect(res.status).toBe(403);
    expect(mockAccounting.closeCashSession).not.toHaveBeenCalled();
  });

  it('owner closes → 200 with the variance snapshot', async () => {
    const res = await closeSession(
      makeRequest(`/api/clinic/accounting/cash/sessions/ses-1/close?clinic_id=${CLINIC_A}`, jsonBody({ counted_amount: 320, notes: 'end of day' })),
      { params: Promise.resolve({ sessionId: 'ses-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.variance).toBe(-5);
    expect(body.data.expectedClosing).toBe(325);
  });

  it('CASH_SESSION_NOT_FOUND → 404', async () => {
    mockAccounting.closeCashSession.mockRejectedValueOnce(new Error('CASH_SESSION_NOT_FOUND'));
    const res = await closeSession(
      makeRequest(`/api/clinic/accounting/cash/sessions/nope/close?clinic_id=${CLINIC_A}`, jsonBody({ counted_amount: 1 })),
      { params: Promise.resolve({ sessionId: 'nope' }) }
    );
    expect(res.status).toBe(404);
  });

  it('sessions + daily reads are FINANCE_READ', async () => {
    expect((await getSessions(makeRequest(`/api/clinic/accounting/cash/sessions?clinic_id=${CLINIC_A}`))).status).toBe(200);
    expect((await getDaily(makeRequest(`/api/clinic/accounting/cash/daily?clinic_id=${CLINIC_A}`))).status).toBe(200);
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: USER }, role: 'staff' });
    expect((await getSessions(makeRequest(`/api/clinic/accounting/cash/sessions?clinic_id=${CLINIC_A}`))).status).toBe(403);
    expect((await getDaily(makeRequest(`/api/clinic/accounting/cash/daily?clinic_id=${CLINIC_A}`))).status).toBe(403);
  });
});

// Tenant isolation contract at the API boundary: the service layer is always
// invoked with the clinic_id that passed authorizeClinicRequest.
describe('Phase C API — tenant scoping contract', () => {
  it('passes the authorized clinic_id to the service (never a mixed one)', async () => {
    await postExpense(makeRequest('/api/clinic/accounting/expenses', jsonBody({ clinic_id: CLINIC_B, amount: 10, method: 'cash' })));
    expect(mockAccounting.recordExpense).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_B }));
    await postExpenseVoid(
      makeRequest(`/api/clinic/accounting/expenses/exp-9/void?clinic_id=${CLINIC_B}`, jsonBody({ reason: 'x' })),
      { params: Promise.resolve({ expenseId: 'exp-9' }) }
    );
    expect(mockAccounting.voidExpense).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_B }));
    await closeSession(
      makeRequest(`/api/clinic/accounting/cash/sessions/ses-9/close?clinic_id=${CLINIC_B}`, jsonBody({ counted_amount: 1 })),
      { params: Promise.resolve({ sessionId: 'ses-9' }) }
    );
    expect(mockAccounting.closeCashSession).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_B }));
  });
});

