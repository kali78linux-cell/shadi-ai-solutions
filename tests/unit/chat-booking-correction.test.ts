import { describe, it, expect } from 'vitest';
import { parseSlotDateTime } from '@/lib/chat/slotParsing';
import { freshConversationState, conversationStorageKeysToPurge } from '@/lib/chat/conversationReset';

describe('NEW CHAT = NEW CONVERSATION (isolation contract)', () => {
  const WELCOME = 'أهلًا بك';
  it('fresh state has a NULL conversation id (server creates a new one on next message)', () => {
    const fresh = freshConversationState(WELCOME);
    expect(fresh.conversationId).toBeNull();
  });
  it('old messages never survive: exactly one welcome message', () => {
    const fresh = freshConversationState(WELCOME);
    expect(fresh.messages).toHaveLength(1);
    expect(fresh.messages[0].text).toBe(WELCOME);
    expect(fresh.messages[0].role).toBe('assistant');
  });
  it('booking state is fully reset (service/provider/date/slot/draft/summary)', () => {
    const fresh = freshConversationState(WELCOME);
    expect(fresh.bookingMode).toBe(false);
    expect(fresh.bookingResult).toBeNull();
    expect(fresh.showBookingSummary).toBe(false);
    expect(fresh.selectedService).toBeNull();
    expect(fresh.selectedProvider).toBeNull();
    expect(fresh.selectedDate).toBeNull();
    expect(fresh.selectedSlot).toBeNull();
    expect(fresh.recommendedServiceId).toBeNull();
    expect(fresh.recommendedProviderId).toBeNull();
    expect(fresh.patientName).toBe('');
    expect(fresh.patientPhone).toBe('');
  });
  it('device pointers purged: conversation id + booking context keys', () => {
    const keys = conversationStorageKeysToPurge('dentalai_chat_conv_clinic-1');
    expect(keys).toContain('dentalai_chat_conv_clinic-1');
    expect(keys).toContain('dentalai_chat_conv_clinic-1_booking');
  });
});

describe('BOOKING slot parsing (root-cause fix for Invalid booking request)', () => {
  it('canonical slot from availability API → correct date/time', () => {
    expect(parseSlotDateTime('2026-09-07T12:00:00.000Z', '')).toEqual({ date: '2026-09-07', time: '12:00' });
  });
  it('partial slot without seconds', () => {
    expect(parseSlotDateTime('2026-09-07T09:30', '')).toEqual({ date: '2026-09-07', time: '09:30' });
  });
  it('space-separated slot', () => {
    expect(parseSlotDateTime('2026-09-07 14:15', '')).toEqual({ date: '2026-09-07', time: '14:15' });
  });
  it('bare HH:mm uses the fallback date (previously produced empty time → 400)', () => {
    expect(parseSlotDateTime('12:00', '2026-09-07')).toEqual({ date: '2026-09-07', time: '12:00' });
  });
  it('empty slot → null (caller surfaces a clear message instead of 400)', () => {
    expect(parseSlotDateTime('', '2026-09-07')).toBeNull();
    expect(parseSlotDateTime(null, '2026-09-07')).toBeNull();
  });
  it('invalid time ranges rejected', () => {
    expect(parseSlotDateTime('2026-09-07T25:00', '')).toBeNull();
    expect(parseSlotDateTime('2026-09-07T12:99', '')).toBeNull();
  });
  it('bare HH:mm WITHOUT fallback date → null (no invented date)', () => {
    expect(parseSlotDateTime('12:00', '')).toBeNull();
  });
});