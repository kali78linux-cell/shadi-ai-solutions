import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  logEvent: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mocks.from(...args),
  },
}));

vi.mock('@/lib/server/logging', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/lib/services/auditService', () => ({ writeAuditLog: mocks.writeAuditLog }));

import {
  createRecallRule,
  generateRecallForCompletedAppointment,
  queueNoShowRecovery,
  addWaitlistEntry,
  matchWaitlistForReleasedSlot,
} from '@/lib/services/growth';

function chain(over: { single?: unknown; singleErr?: unknown; maybe?: unknown; maybeErr?: unknown } = {}) {
  const state: any = {};
  const q: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: over.single ?? null, error: over.singleErr ?? null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: over.maybe ?? null, error: over.maybeErr ?? null }),
  };
  q.select = vi.fn(() => q);
  state.q = q;
  return { q, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReset();
});

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PATIENT = '22222222-2222-2222-2222-222222222222';
const APPT = '33333333-3333-3333-3333-333333333333';
const SERVICE = '44444444-4444-4444-4444-444444444444';

describe('growth service', () => {
  it('createRecallRule inserts scoped rule', async () => {
    const { q } = chain({ single: { id: 'r1', clinic_id: CLINIC, service_id: SERVICE, recall_after_days: 30 } });
    mocks.from.mockReturnValue(q);
    const rule = await createRecallRule({ clinicId: CLINIC, serviceId: SERVICE, recallAfterDays: 30 });
    expect(rule.recall_after_days).toBe(30);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'recall_rule_created' }));
  });

  it('generateRecall uses service rule then fallback and returns null on duplicate (23505)', async () => {
    // listRecallRules
    const { q: q1 } = chain({ single: null });
    const { q: q2 } = chain({ single: [{ id: 'r1', clinic_id: CLINIC, service_id: null, recall_after_days: 30, enabled: true, created_at: '', updated_at: '' }] });
    // create insert → duplicate
    const { q: q3 } = chain({ single: null, singleErr: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    mocks.from.mockReturnValueOnce(q1).mockReturnValueOnce(q2).mockReturnValueOnce(q3);
    const result = await generateRecallForCompletedAppointment({
      clinicId: CLINIC,
      patientId: PATIENT,
      serviceId: SERVICE,
      completedAt: '2026-09-01',
      linkedAppointmentId: APPT,
    });
    expect(result).toBeNull();
  });

  it('queueNoShowRecovery inserts once and skips duplicates', async () => {
    const { q } = chain({ single: { id: 'n1' } });
    mocks.from.mockReturnValue(q);
    const r = await queueNoShowRecovery({ clinicId: CLINIC, appointmentId: APPT, patientId: PATIENT });
    expect(r?.id).toBe('n1');

    mocks.from.mockReset();
    const { q: q2 } = chain({ single: null, singleErr: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    mocks.from.mockReturnValue(q2);
    const r2 = await queueNoShowRecovery({ clinicId: CLINIC, appointmentId: APPT, patientId: PATIENT });
    expect(r2).toBeNull();
  });

  it('addWaitlistEntry requires active status and writes audit', async () => {
    const { q } = chain({ single: { id: 'w1', clinic_id: CLINIC, patient_id: PATIENT, status: 'active' } });
    mocks.from.mockReturnValue(q);
    const entry = await addWaitlistEntry({
      clinicId: CLINIC,
      patientId: PATIENT,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(entry.status).toBe('active');
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'waitlist_entry_created' }));
  });

  it('matchWaitlistForReleasedSlot claims the best entry once and queues offer', async () => {
    // candidates query (chain ends with .limit) → one matching candidate
    const { q: cand } = chain({ single: null });
    cand.limit.mockResolvedValueOnce({ data: [{ id: 'w1', clinic_id: CLINIC, patient_id: PATIENT, provider_id: null, service_id: null, priority: 5, expires_at: new Date(Date.now() + 86400000).toISOString(), status: 'active', created_at: '' }], error: null });
    mocks.from.mockReturnValueOnce(cand);
    // claim update → claimed
    const { q: claim } = chain({ single: { id: 'w1', clinic_id: CLINIC, patient_id: PATIENT, provider_id: null, service_id: null, priority: 5, status: 'notified', created_at: '' } });
    mocks.from.mockReturnValueOnce(claim);
    // offer insert
    const { q: offer } = chain({ single: { id: 'n1' } });
    mocks.from.mockReturnValueOnce(offer);

    const matched = await matchWaitlistForReleasedSlot({
      clinicId: CLINIC,
      appointmentId: APPT,
      providerId: '55555555-5555-5555-5555-555555555555',
      serviceId: null,
      releasedAt: '2026-09-05T10:00:00Z',
    });
    expect(matched?.id).toBe('w1');
  });
});
