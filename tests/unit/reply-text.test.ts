import { describe, expect, it } from 'vitest';
import { unavailableReply, expressesTreatmentDesire } from '@/lib/ai/replyText';

/**
 * PRODUCT BEHAVIOR regressions:
 *  1. The dead-end reply must be GENDER-NEUTRAL (no «تواجهين/موظفة الاستقبال»
 *     assumptions) and actionable.
 *  2. A concrete treatment desire («بدي اعمل تقويم») must bypass the dead-end.
 */

describe('unavailableReply', () => {
  it('never contains gendered address forms', () => {
    const ar = unavailableReply('ar');
    expect(ar).not.toMatch(/تواجهين|ستجدين|يمكنكِ|بكِ|موظفة/);
    expect(ar).toContain('غير متوفرة');
    const en = unavailableReply('en');
    expect(en).toMatch(/isn't available/i);
  });

  it('offers concrete next steps instead of a dead end', () => {
    const ar = unavailableReply('ar');
    expect(ar).toMatch(/حجز موعد|فريق الاستقبال/);
  });
});

describe('expressesTreatmentDesire (safety-net only)', () => {
  it.each([
    'بدي اعمل تقويم اسنان',
    'بدي تقويم',
    'نفسي أركب تقويم',
    'أريد حشو الضرس',
    'بدي تنظيف أسنان',
    'ممكن أحجز موعد',
    'I want braces',
  ])('detects treatment desire: %s', (message) => {
    expect(expressesTreatmentDesire(message)).toBe(true);
  });

  it.each([
    'شو أسعاركم؟',
    'وين موقع العيادة؟',
    'مرحبا',
    'طاحونتي بتوجعني',
    'متى موعدي؟',
  ])('does NOT fire on plain questions/complaints: %s', (message) => {
    expect(expressesTreatmentDesire(message)).toBe(false);
  });
});