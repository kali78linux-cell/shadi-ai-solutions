import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: { from: vi.fn() },
  getConversationById: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock('@/lib/services/conversationService', () => ({ getConversationById: mocks.getConversationById }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  buildHandoffSummary,
  notifyStaffForHandoff,
  type HandoffSummary,
} from '@/lib/services/notificationService';
import {
  handoffReplyForIntent,
  persistHandoffReply,
  EMERGENCY_HANDOFF_MESSAGE,
  HUMAN_HANDOFF_MESSAGE,
} from '@/lib/ai/handoffMessages';

const clinicId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';

beforeEach(() => { vi.clearAllMocks(); });

describe('handoffReplyForIntent — patient always gets an answer (P0)', () => {
  it('emergency intent → urgent-care instructions (never a generic apology)', () => {
    const reply = handoffReplyForIntent('emergency');
    expect(reply.emergency).toBe(true);
    expect(reply.content).toBe(EMERGENCY_HANDOFF_MESSAGE);
    expect(reply.content).toContain('طوارئ');
    expect(reply.content).not.toContain('مشكلة مؤقتة');
  });

  it('urgent_signal alias also maps to emergency instructions', () => {
    expect(handoffReplyForIntent('urgent_signal').emergency).toBe(true);
  });

  it('human handoff → acknowledgment, not emergency scare', () => {
    const reply = handoffReplyForIntent('human_handoff');
    expect(reply.emergency).toBe(false);
    expect(reply.content).toBe(HUMAN_HANDOFF_MESSAGE);
  });
});

describe('persistHandoffReply — transcript matches what the patient was told', () => {
  it('persists the assistant message and returns its id', async () => {
    const inserted: any[] = [];
    const single = vi.fn(async () => ({ data: { id: 'msg-1' }, error: null }));
    const insert = vi.fn((row: any[]) => { inserted.push(...row); return { select: vi.fn(() => ({ single })) }; });
    mocks.supabaseAdmin.from.mockImplementation((table: string) => {
      expect(table).toBe('messages');
      return { insert };
    });

    const result = await persistHandoffReply({ supabase: mocks.supabaseAdmin as any, clinicId, conversationId, intent: 'emergency' });
    expect(result.persistedId).toBe('msg-1');
    expect(result.emergency).toBe(true);
    expect(inserted[0].role).toBe('assistant');
    expect(inserted[0].content).toBe(EMERGENCY_HANDOFF_MESSAGE);
    expect(inserted[0].metadata.emergency).toBe(true);
  });

  it('persistence failure NEVER prevents the reply from reaching the caller', async () => {
    const insert = vi.fn(() => { throw new Error('db down'); });
    mocks.supabaseAdmin.from.mockReturnValue({ insert } as any);

    const result = await persistHandoffReply({ supabase: mocks.supabaseAdmin as any, clinicId, conversationId, intent: 'human_handoff' });
    expect(result.persistedId).toBeNull();
    expect(result.content).toBe(HUMAN_HANDOFF_MESSAGE);
  });
});

describe('buildHandoffSummary — staff never starts from zero (Phase 13)', () => {
  const conversationRow = {
    intent: 'patient_complaint',
    urgency: 'high',
    patient_id: 'patient-1',
    metadata: {
      subject_analysis: {
        problem: 'وجع ضرس سفلي',
        duration: 'من أسبوع',
        trigger: 'الماء البارد',
        swelling: true,
        fever: false,
        bleeding: null,
        trauma: null,
        recommended_service: 'علاج عصب',
        recommended_provider: 'د. أحمد',
      },
      booking: { phone: '0599111222', status: 'tentative', appointment_id: 'appt-9' },
      recommended_service_id: 'svc-1',
      recommended_provider_id: 'prov-1',
      handoff_reason: 'patient_complaint',
    },
  };

  it('includes identity, problem, symptoms, urgency, request, appointment status and excerpt', () => {
    const summary: HandoffSummary = buildHandoffSummary({
      conversationId,
      conversation: conversationRow,
      patient: { full_name: 'محمد أحمد', phone_number: '0599000000', email: null },
      messages: [
        { role: 'patient', content: 'طاحونتي بتوجعني' },
        { role: 'assistant', content: 'من متى بدأ الوجع؟' },
      ],
    });

    expect(summary.patient.name).toBe('محمد أحمد');
    expect(summary.problem).toBe('وجع ضرس سفلي');
    expect(summary.urgency).toBe('high');
    expect(summary.symptoms.duration).toBe('من أسبوع');
    expect(summary.symptoms.swelling).toBe(true);
    expect(summary.requested.service).toBe('علاج عصب');
    expect(summary.requested.service_id).toBe('svc-1');
    expect(summary.appointment_status).toBe('tentative');
    expect(summary.transcript_excerpt.at(-1)?.content).toBe('من متى بدأ الوجع؟');
    // No invented data:
    expect(JSON.stringify(summary)).not.toContain('Demo');
  });

  it('falls back to booking-collected identity when no patient row exists yet', () => {
    const summary = buildHandoffSummary({
      conversationId,
      conversation: conversationRow,
      patient: null,
      messages: [],
    });
    expect(summary.patient.phone).toBe('0599111222');
    expect(summary.transcript_excerpt).toEqual([]);
  });

  it('caps the excerpt at the last 6 messages', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'patient', content: `m${i}` }));
    const summary = buildHandoffSummary({ conversationId, conversation: conversationRow, messages: many });
    expect(summary.transcript_excerpt).toHaveLength(6);
    expect(summary.transcript_excerpt[0].content).toBe('m4');
    expect(summary.transcript_excerpt.at(-1)?.content).toBe('m9');
  });
});

describe('notifyStaffForHandoff — persists a full-summary notification', () => {
  it('inserts a notification whose payload is the structured summary', async () => {
    mocks.getConversationById.mockResolvedValue({
      id: conversationId,
      clinic_id: clinicId,
      intent: 'human_handoff',
      urgency: null,
      patient_id: null,
      metadata: {},
    });

    const inserted: any[] = [];
    mocks.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'notifications') {
        const insert = vi.fn((row: any) => { inserted.push(row); return { error: null }; });
        return { insert };
      }
      // patients / messages enrichment queries → chainable empty results
      const q: any = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.is = vi.fn(() => q);
      q.order = vi.fn(() => q);
      q.limit = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      return q;
    });

    await notifyStaffForHandoff(clinicId, conversationId);

    expect(inserted).toHaveLength(1);
    const payload = inserted[0].payload;
    expect(payload.conversation_id).toBe(conversationId);
    expect(payload.reason).toBe('human_handoff_requested');
    expect(payload.patient.id).toBeNull();
  });
});

