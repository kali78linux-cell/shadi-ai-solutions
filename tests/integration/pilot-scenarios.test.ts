import { describe, it, expect } from 'vitest';
import { detectConversationIntelligence } from '@/lib/ai/intelligence';
import { buildPrompt } from '@/lib/ai/promptManager';
import { checkSlotAvailability, type ProviderSchedule, type ScheduledAppointment } from '@/lib/services/scheduling';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const PROVIDER = '33333333-3333-3333-3333-333333333333';

const mondaySchedule: ProviderSchedule = {
  providerId: PROVIDER,
  clinicId: CLINIC_A,
  days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00', breaks: [] }],
  appointmentDurationMinutes: 30,
  maxAppointmentsPerDay: null,
};

describe('Pilot Patient Scenarios', () => {
  describe('Conversation Intelligence Scenarios', () => {
    it('detects appointment booking intent in Arabic', () => {
      const result = detectConversationIntelligence('أريد حجز موعد لتنظيف الأسنان يوم الاثنين');
      expect(result.intent).toBe('appointment_booking');
      expect(result.urgency).toBe('normal');
      expect(result.shouldHandoff).toBe(false);
    });

    it('detects emergency intent and triggers handoff', () => {
      const result = detectConversationIntelligence('I have severe pain and bleeding, it is urgent');
      expect(result.intent).toBe('emergency');
      expect(result.shouldHandoff).toBe(true);
      expect(result.urgency).toBe('critical');
    });

    it('detects human handoff request', () => {
      const result = detectConversationIntelligence('I need to speak to a human agent now');
      expect(result.intent).toBe('human_handoff');
      expect(result.shouldHandoff).toBe(true);
    });

    it('detects insurance inquiry', () => {
      const result = detectConversationIntelligence('Do you accept Cigna insurance?');
      expect(result.intent).toBe('insurance_inquiry');
      expect(result.shouldHandoff).toBe(false);
    });

    it('extracts patient appointment details', () => {
      const result = detectConversationIntelligence('My name is Ahmed. I want to book a root canal on 2026-08-20 at 10:00');
      expect(result.appointment.patientName).toBe('Ahmed');
      expect(result.appointment.requestedService).toContain('root canal');
      expect(result.appointment.preferredDate).toContain('2026-08-20');
    });

    it('handles mixed Arabic/English conversation', () => {
      const result = detectConversationIntelligence('مرحبا، I want to book an appointment');
      expect(result.intent).toBe('appointment_booking');
    });
  });

  describe('Schedule Availability Scenarios', () => {
    it('allows booking in available slot', () => {
      const result = checkSlotAvailability({
        startsAt: '2026-08-17T09:00:00.000Z', // Monday
        durationMinutes: 30,
        schedule: mondaySchedule,
        existingAppointments: [],
      });
      expect(result.available).toBe(true);
    });

    it('rejects booking outside working hours', () => {
      const result = checkSlotAvailability({
        startsAt: '2026-08-17T08:00:00.000Z', // Before 9:00
        durationMinutes: 30,
        schedule: mondaySchedule,
        existingAppointments: [],
      });
      expect(result.available).toBe(false);
      expect(result.reason).toBe('outside_working_hours');
    });

    it('rejects booking on non-working day', () => {
      const result = checkSlotAvailability({
        startsAt: '2026-08-16T10:00:00.000Z', // Sunday
        durationMinutes: 30,
        schedule: mondaySchedule,
        existingAppointments: [],
      });
      expect(result.available).toBe(false);
      expect(result.reason).toBe('provider_unavailable');
    });

    it('rejects overlapping appointment', () => {
      const existing: ScheduledAppointment[] = [{
        startsAt: '2026-08-17T09:00:00.000Z',
        durationMinutes: 45,
        status: 'confirmed',
      }];
      const result = checkSlotAvailability({
        startsAt: '2026-08-17T09:30:00.000Z',
        durationMinutes: 30,
        schedule: mondaySchedule,
        existingAppointments: existing,
      });
      expect(result.available).toBe(false);
      expect(result.reason).toBe('overlap');
    });

    it('rejects slot during break', () => {
      const scheduleWithBreak: ProviderSchedule = {
        ...mondaySchedule,
        days: [{ weekday: 1, enabled: true, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }],
      };
      const result = checkSlotAvailability({
        startsAt: '2026-08-17T12:30:00.000Z',
        durationMinutes: 30,
        schedule: scheduleWithBreak,
        existingAppointments: [],
      });
      expect(result.available).toBe(false);
      expect(result.reason).toBe('break_time');
    });

    it('rejects past date booking', () => {
      const result = checkSlotAvailability({
        startsAt: '2020-01-01T10:00:00.000Z',
        durationMinutes: 30,
        schedule: mondaySchedule,
        existingAppointments: [],
      });
      expect(result.available).toBe(false);
    });
  });

  describe('AI Safety Scenarios', () => {
    it('includes medical safety rules in prompt', () => {
      const prompt = buildPrompt(null, 'What disease do I have?', [], [], undefined, {
        safetyRules: [
          'Never provide a medical diagnosis.',
          'Never prescribe medication or recommend specific dosages.',
        ],
        answerBoundaries: [
          'Only answer using the provided context.',
        ],
      });
      expect(prompt).toContain('Never provide a medical diagnosis.');
      expect(prompt).toContain('Never prescribe medication');
      expect(prompt).toContain('Only answer using the provided context.');
    });

    it('includes handoff conditions for emergency', () => {
      const prompt = buildPrompt(null, 'I am bleeding badly', [], [], undefined, {
        handoffConditions: [
          'Hand off to a human agent if the patient requests emergency care.',
        ],
      });
      expect(prompt).toContain('Hand off to a human agent if the patient requests emergency care.');
    });

    it('includes anti-hallucination instructions', () => {
      const prompt = buildPrompt(null, 'Make up an answer', [], [
        { id: 'chunk-1', document_id: 'doc-1', chunk_index: 0, content: 'Clinic info', similarity: 0.9, type: 'unstructured' as const },
      ], undefined, {
        answerBoundaries: [
          'Only answer using the provided context.',
          'If the context does not contain the answer, state that you do not have that information.',
        ],
      });
      expect(prompt).toContain('Only answer using the provided context.');
      expect(prompt).toContain('state that you do not have that information');
    });
  });

});
