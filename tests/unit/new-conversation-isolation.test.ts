import { describe, it, expect } from 'vitest';
import { freshConversationState, conversationStorageKeysToPurge } from '@/lib/chat/conversationReset';

describe('New Conversation isolation (P0/P1 contract)', () => {
  const dirtyPreviousSession = {
    conversationId: 'conv-OLD-123',
    messages: [
      { role: 'user' as const, text: 'طاحونتي بتوجعني من أسبوع' },
      { role: 'assistant' as const, text: 'أهلاً محمد، كيف أقدر أساعدك؟' },
    ],
    showSuggested: false,
    statusMessage: 'old status',
    aiUnavailable: true,
    bookingMode: true,
    bookingResult: { appointment_id: 'appt-OLD', service: 'تقويم', date: '2026-09-01', time: '10:00', status: 'tentative', booking_token: 'tok-OLD' },
    bookingError: 'old error',
    showBookingSummary: true,
    recommendedServiceId: 'svc-OLD',
    recommendedProviderId: 'prov-OLD',
    selectedService: 'svc-OLD',
    selectedProvider: 'prov-OLD',
    selectedDate: '2026-09-01',
    slots: ['2026-09-01T10:00:00.000Z'],
    selectedSlot: '2026-09-01T10:00:00.000Z',
    patientName: 'محمد أحمد',
    patientPhone: '0599999999',
    patientEmail: 'm@example.com',
    showCancel: true,
    cancelAppointmentId: 'appt-OLD',
    cancelToken: 'tok-OLD',
    cancelResult: { id: 'appt-OLD' },
    cancelError: 'old cancel error',
    showReschedule: true,
    rescheduleAppointmentId: 'appt-OLD',
    rescheduleToken: 'tok-OLD',
    rescheduleResult: { id: 'appt-OLD' },
    rescheduleError: 'old resched error',
  };

  it('carries NOTHING from the previous session into the new conversation state', () => {
    const fresh = freshConversationState('أهلًا بك 👋');

    // The old conversation id must never appear anywhere in the fresh state.
    const serialized = JSON.stringify(fresh);
    expect(serialized).not.toContain('conv-OLD');
    expect(serialized).not.toContain('appt-OLD');
    expect(serialized).not.toContain('tok-OLD');
    expect(serialized).not.toContain('0599999999');
    expect(serialized).not.toContain('محمد');
    expect(serialized).not.toContain('تقويم');

    // Identity/context resets
    expect(fresh.conversationId).toBeNull();
    expect(fresh.patientName).toBe('');
    expect(fresh.patientPhone).toBe('');
    expect(fresh.patientEmail).toBe('');

    // Booking context resets completely
    expect(fresh.bookingMode).toBe(false);
    expect(fresh.bookingResult).toBeNull();
    expect(fresh.showBookingSummary).toBe(false);
    expect(fresh.recommendedServiceId).toBeNull();
    expect(fresh.recommendedProviderId).toBeNull();
    expect(fresh.selectedService).toBeNull();
    expect(fresh.selectedProvider).toBeNull();
    expect(fresh.selectedSlot).toBeNull();
    expect(fresh.slots).toEqual([]);

    // Messages contain ONLY the welcome banner — no old transcript.
    expect(fresh.messages).toHaveLength(1);
    expect(fresh.messages[0].text).toBe('أهلًا بك 👋');

    // UI flags reset
    expect(fresh.showSuggested).toBe(true);
    expect(fresh.aiUnavailable).toBe(false);
    expect(fresh.statusMessage).toBeNull();

    for (const key of Object.keys(dirtyPreviousSession)) {
      if (key === 'messages') continue;
      expect((fresh as any)[key]).not.toEqual((dirtyPreviousSession as any)[key]);
    }
  });

  it('purges BOTH the conversation pointer and the separate booking-context key', () => {
    const keys = conversationStorageKeysToPurge('dentalai_chat_conv_clinic-x');
    expect(keys).toContain('dentalai_chat_conv_clinic-x');
    expect(keys).toContain('dentalai_chat_conv_clinic-x_booking');
    expect(keys).toHaveLength(2);
  });
});
