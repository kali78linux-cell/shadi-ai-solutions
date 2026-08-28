import { describe, expect, it } from 'vitest';
import { detectConversationIntelligence } from '@/lib/ai/intelligence';

describe('conversation intelligence', () => {
  it('detects emergency and requires human handoff', () => {
    const result = detectConversationIntelligence('This is an emergency, I have severe pain and bleeding');
    expect(result.intent).toBe('emergency');
    expect(result.urgency).toBe('critical');
    expect(result.shouldHandoff).toBe(true);
    expect(result.lead.temperature).toBe('hot');
  });

  it('detects booking and extracts appointment details', () => {
    const result = detectConversationIntelligence('I want to book a root canal on 2026-08-01 at 10:30 am. My name is Sara Ali, phone 555-123-4567, email sara@example.com');
    expect(result.intent).toBe('appointment_booking');
    expect(result.appointment).toMatchObject({
      patientName: 'Sara Ali',
      phone: '555-123-4567',
      email: 'sara@example.com',
      preferredDate: '2026-08-01',
      preferredTime: '10:30 am',
      requestedService: 'root canal',
    });
    expect(result.lead.temperature).toBe('hot');
  });

  it('supports Arabic intent detection', () => {
    const result = detectConversationIntelligence('ما هي أسعار تنظيف الأسنان وهل يقبل العيادة التأمين؟');
    expect(['pricing_inquiry', 'insurance_inquiry']).toContain(result.intent);
    expect(result.lead.temperature).toBe('warm');
  });

  // Production deliberately treats unknown/greeting/general as conversational and
  // lets the AI answer. The real handoff guard fires on a MATCHED non-conversational
  // intent whose confidence falls below the configured threshold.
  it('hands off low-confidence non-conversational messages at a configured threshold', () => {
    const result = detectConversationIntelligence('where is the clinic located', 0.8);
    expect(result.intent).toBe('location');
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.state).toBe('awaiting_staff');
  });
});
