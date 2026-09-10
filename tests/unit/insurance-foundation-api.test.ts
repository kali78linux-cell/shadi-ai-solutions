import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn((auth: any, _roles: readonly string[]) =>
    auth && auth.authorized === false ? { authorized: false, status: auth.status ?? 403 } : null),
  FINANCE_ADMIN_ROLES: ['owner', 'accountant'],
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

const mockSupabaseAdmin = vi.hoisted(() => {
  function makeBuilder(result: { data: unknown; error: unknown }) {
    const b: Record<string, any> = {};
    const CHAIN = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'order', 'limit', 'single', 'maybeSingle'];
    for (const m of CHAIN) b[m] = vi.fn(() => b);
    b.then = (resolve: (v: unknown) => void) => resolve(result);
    return b;
  }
  const supabaseAdmin = {
    from: vi.fn(() => makeBuilder({ data: [], error: null })),
    rpc: vi.fn(async () => ({ data: {}, error: null })),
  };
  return { supabaseAdmin };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

import { POST as postPayer, GET as listPayers } from '@/app/api/clinic/insurance/payers/route';
import { POST as postClaim } from '@/app/api/clinic/insurance/claims/route';
import { POST as submitClaimRoute } from '@/app/api/clinic/insurance/claims/[claimId]/submit/route';
import { POST as settleClaimRoute } from '@/app/api/clinic/insurance/claims/[claimId]/settle/route';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}
const authedOwner = () => mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
const params = (id: string) => ({ params: Promise.resolve({ claimId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  authedOwner();
});

describe('insurance payers API', () => {
  it('creates a payer (201) for FINANCE_ADMIN', async () => {
    const builder: Record<string, any> = {};
    const CHAIN = ['select', 'insert', 'eq', 'single'];
    for (const m of CHAIN) builder[m] = vi.fn(() => builder);
    builder.then = (resolve: (v: unknown) => void) =>
      resolve({ data: { id: 'pay1', name: 'Grand Insurance', payer_type: 'insurance', is_active: true }, error: null });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);
    const res = await postPayer(makeRequest('/api/clinic/insurance/payers', jsonBody({
      clinic_id: CLINIC, name: 'Grand Insurance', payer_type: 'insurance',
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('Grand Insurance');
  });

  it('401 when unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await postPayer(makeRequest('/api/clinic/insurance/payers', jsonBody({ clinic_id: CLINIC, name: 'X' })));
    expect(res.status).toBe(401);
  });

  it('403 when not a FINANCE_ADMIN (writes denied for non-finance roles)', async () => {
    mockAuth.roleDenied.mockImplementationOnce(() => ({ authorized: false, status: 403 }));
    const res = await postPayer(makeRequest('/api/clinic/insurance/payers', jsonBody({ clinic_id: CLINIC, name: 'X' })));
    expect(res.status).toBe(403);
  });

  it('GET lists payers for FINANCE_READ', async () => {
    const res = await listPayers(makeRequest(`/api/clinic/insurance/payers?clinic_id=${CLINIC}`));
    expect(res.status).toBe(200);
  });

  it('400 when clinic_id missing', async () => {
    const res = await postPayer(makeRequest('/api/clinic/insurance/payers', jsonBody({ name: 'X' })));
    expect(res.status).toBe(400);
  });
});

describe('insurance claims API (D-I2 contract)', () => {
  it('creates a claim → 201 with draft status from RPC', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({
      data: { claim_id: 'c1', claim_number: 'CLM-2026-000001', status: 'draft', duplicate: false }, error: null,
    });
    const res = await postClaim(makeRequest('/api/clinic/insurance/claims', jsonBody({
      clinic_id: CLINIC, patient_id: 'p1', payer_id: 'pay1', invoice_id: 'inv1', claimed_amount: 100,
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('draft');
  });

  it('maps domain rejections to 400 (payer of another clinic → PAYER_NOT_FOUND)', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'PAYER_NOT_FOUND' } });
    const res = await postClaim(makeRequest('/api/clinic/insurance/claims', jsonBody({
      clinic_id: CLINIC_B, patient_id: 'p1', payer_id: 'pay-other-clinic', invoice_id: 'inv1', claimed_amount: 100,
    })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PAYER_NOT_FOUND');
  });

  it('submit → 200 state change', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: { claim_id: 'c1', status: 'submitted' }, error: null });
    const res = await submitClaimRoute(makeRequest('/api/clinic/insurance/claims/c1/submit', jsonBody({ clinic_id: CLINIC })), params('c1'));
    expect(res.status).toBe(200);
  });

  it('settle → 200 and never touches payments (settlement is not cash, D-I2)', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({
      data: { claim_id: 'c1', status: 'settled', settled_amount: 80, duplicate: false }, error: null,
    });
    const res = await settleClaimRoute(makeRequest('/api/clinic/insurance/claims/c1/settle', jsonBody({
      clinic_id: CLINIC, settled_amount: 80,
    })), params('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('settled');
    // The route must not issue any payment-write call: no .from('clinic_payments') insert.
    expect(mockSupabaseAdmin.supabaseAdmin.from).not.toHaveBeenCalledWith('clinic_payments');
  });

  it('settle without settled_amount → 400', async () => {
    const res = await settleClaimRoute(makeRequest('/api/clinic/insurance/claims/c1/settle', jsonBody({ clinic_id: CLINIC })), params('c1'));
    expect(res.status).toBe(400);
  });

  it('invalid transition → 400 (INVALID_CLAIM_STATUS)', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'INVALID_CLAIM_STATUS' } });
    const res = await submitClaimRoute(makeRequest('/api/clinic/insurance/claims/c1/submit', jsonBody({ clinic_id: CLINIC })), params('c1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_CLAIM_STATUS');
  });
});
