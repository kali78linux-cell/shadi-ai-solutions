import { describe, expect, it } from 'vitest';
import {
  buildConversationSummaries,
  previewText,
  type ConversationLike,
  type LinkedAppointment,
} from '@/lib/services/conversationSummary';

/**
 * Conversation Session ≠ Patient ≠ Appointment.
 * These tests pin the enrichment rules that turn raw conversation rows into
 * staff-readable summaries without inventing identities.
 */

const baseConversation = (overrides: Partial<ConversationLike> = {}): ConversationLike => ({
  id: 'conv-1',
  clinic_id: 'clinic-A',
  session_id: 'public:1787089966904',
  status: 'open',
  created_at: '2026-08-26T10:00:00Z',
  updated_at: '2026-08-26T10:05:00Z',
  metadata: {},
  ...overrides,
});

describe('buildConversationSummaries', () => {
  it('renders a known visitor from in-chat identity (booking meta wins)', () => {
    const [summary] = buildConversationSummaries({
      conversations: [
        baseConversation({
          metadata: {
            subject_analysis: { patient_name: 'قديم من التحليل', phone: '0500000000' },
            booking: { patient_name: 'علي جمال', phone: '0599111222' },
          },
        }),
      ],
      latestMessageByConversation: {},
      appointmentByConversation: {},
      patientById: {},
    });

    expect(summary.display_name).toBe('علي جمال');
    expect(summary.is_known_visitor).toBe(true);
    expect(summary.phone).toBe('0599111222');
  });

  it('falls back to subject_analysis then linked patient record', () => {
    const [fromSubject] = buildConversationSummaries({
      conversations: [baseConversation({ metadata: { subject_analysis: { patient_name: 'سارة' } } })],
      latestMessageByConversation: {},
      appointmentByConversation: {},
      patientById: {},
    });
    expect(fromSubject.display_name).toBe('سارة');

    const [fromRecord] = buildConversationSummaries({
      conversations: [baseConversation({ patient_id: 'p-1' })],
      latestMessageByConversation: {},
      appointmentByConversation: {},
      patientById: { 'p-1': { name: 'من السجل', phone: '0533444555' } },
    });
    expect(fromRecord.display_name).toBe('من السجل');
    expect(fromRecord.phone).toBe('0533444555');
    expect(fromRecord.patient_id).toBe('p-1');
  });

  it('unknown visitor stays anonymous — no fake identity is invented', () => {
    const [summary] = buildConversationSummaries({
      conversations: [baseConversation()],
      latestMessageByConversation: { 'conv-1': { content: 'مرحبا', created_at: '2026-08-26T10:01:00Z' } },
      appointmentByConversation: {},
      patientById: {},
    });

    expect(summary.display_name).toBeNull();
    expect(summary.is_known_visitor).toBe(false);
    expect(summary.phone).toBeNull();
    expect(summary.last_message_preview).toBe('مرحبا');
  });

  it('extracts problem, urgency, service and provider recommendations', () => {
    const [summary] = buildConversationSummaries({
      conversations: [
        baseConversation({
          metadata: {
            subject_analysis: {
              problem: 'ألم في الطاحونة',
              urgency: 'high',
              recommended_service: 'طوارئ أسنان',
              recommended_provider: 'د. أحمد خالد',
            },
          },
        }),
      ],
      latestMessageByConversation: {},
      appointmentByConversation: {},
      patientById: {},
    });

    expect(summary.problem_summary).toBe('ألم في الطاحونة');
    expect(summary.urgency).toBe('high');
    expect(summary.recommended_service).toBe('طوارئ أسنان');
    expect(summary.recommended_provider).toBe('د. أحمد خالد');
  });

  it('links the appointment booked through this session', () => {
    const [summary] = buildConversationSummaries({
      conversations: [baseConversation()],
      latestMessageByConversation: {},
      appointmentByConversation: {
        'conv-1': {
          id: 'appt-9',
          patient_id: null,
          service: 'فحص أسنان',
          appointment_date: '2026-08-27',
          scheduled_at: '13:30',
          status: 'scheduled',
          provider_name: 'د. أحمد خالد',
        },
      },
      patientById: {},
    });

    expect(summary.has_booking).toBe(true);
    expect(summary.booking?.id).toBe('appt-9');
    expect(summary.booking?.provider_name).toBe('د. أحمد خالد');
  });

  it('needs_attention is true ONLY for explicit handoff state', () => {
    const [openOne, handoff, closedOne] = buildConversationSummaries({
      conversations: [
        baseConversation({ id: 'a', status: 'open' }),
        baseConversation({ id: 'b', status: 'awaiting_human' }),
        baseConversation({ id: 'c', status: 'closed' }),
      ],
      latestMessageByConversation: {},
      appointmentByConversation: {},
      patientById: {},
    });

    expect(openOne.needs_attention).toBe(false);
    expect(handoff.needs_attention).toBe(true);
    expect(closedOne.needs_attention).toBe(false);
  });

  it('keeps each session independent — no cross-session bleeding', () => {
    const summaries = buildConversationSummaries({
      conversations: [
        baseConversation({ id: 'A', metadata: { subject_analysis: { problem: 'تقويم للابن' } } }),
        baseConversation({ id: 'B' }),
      ],
      latestMessageByConversation: {
        A: { content: 'بدي تقويم لابني', created_at: null },
        B: { content: 'السلام عليكم', created_at: null },
      },
      appointmentByConversation: {},
      patientById: {},
    });

    expect(summaries.find((s) => s.id === 'A')?.problem_summary).toBe('تقويم للابن');
    expect(summaries.find((s) => s.id === 'B')?.problem_summary).toBeNull();
    expect(summaries.find((s) => s.id === 'B')?.last_message_preview).toBe('السلام عليكم');
  });

  // REGRESSION («زائر جديد» despite confirmed booking): identity must resolve
  // through Conversation → Appointment → Patient when conversations.patient_id
  // is still null but the APPOINTMENT carries its own real patient link.
  it('resolves identity through the APPOINTMENT patient link', () => {
    const [summary] = buildConversationSummaries({
      conversations: [baseConversation({ metadata: {} })],
      latestMessageByConversation: {},
      appointmentByConversation: {
        'conv-1': {
          id: 'appt-10',
          patient_id: 'pat-77',
          service: 'تنظيف',
          appointment_date: '2026-08-28',
          scheduled_at: '10:00',
          status: 'scheduled',
          provider_name: null,
        },
      },
      patientById: { 'pat-77': { name: 'محمود عليان', phone: '0598765432' } },
    });

    expect(summary.display_name).toBe('محمود عليان');
    expect(summary.is_known_visitor).toBe(true);
    expect(summary.phone).toBe('0598765432');
  });

  // REGRESSION («لم تُذكر المشكلة بعد» despite «طاحونتي بتجعني»): when metadata
  // analysis never populated, problem_summary falls back to what the patient
  // ACTUALLY wrote — never a blank stub while real words exist.
  it('falls back to the patient’s own words for problem_summary', () => {
    const [withPatientWords, withoutAny] = buildConversationSummaries({
      conversations: [baseConversation({ id: 'A' }), baseConversation({ id: 'B' })],
      latestMessageByConversation: {
        A: { content: 'رد المساعد', created_at: '2026-08-26T10:02:00Z' },
        B: { content: 'مرحبا', created_at: null },
      },
      latestPatientMessageByConversation: {
        A: { content: 'طاحونتي بتجعني من مبارح', created_at: '2026-08-26T10:01:00Z' },
      },
      appointmentByConversation: {},
      patientById: {},
    });

    expect(withPatientWords.problem_summary).toBe('طاحونتي بتجعني من مبارح');
    expect(withoutAny.problem_summary).toBeNull();
  });
});

describe('previewText', () => {
  it('returns short text untouched and truncates long text safely', () => {
    expect(previewText(null)).toBeNull();
    expect(previewText('   مرحلة   قصيرة  ')).toBe('مرحلة قصيرة');
    const preview = previewText('ا'.repeat(200), 120)!;
    expect(Array.from(preview)).toHaveLength(121); // 120 chars + ellipsis
    expect(preview.endsWith('…')).toBe(true);
  });
});