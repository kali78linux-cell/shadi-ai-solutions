/**
 * STEP 12A-FIX — extraction regression: explicit service desires in Levantine
 * Arabic must be extracted as requested_service even when the LLM classifier
 * might label them patient_complaint. Deliberately narrow — bare mentions
 * ("هل الأشعة خطيرة؟", "الدكتور طلب مني أشعة") are NOT treated as booking
 * desires.
 */
import { describe, expect, it } from 'vitest';
import { extractRequestedServiceFromText } from '@/lib/ai/intentClassifier';

describe('extractRequestedServiceFromText (STEP 12A-FIX)', () => {
  it('extracts أشعة أسنان from "بدي أعمل أشعة أسنان"', () => {
    const out = extractRequestedServiceFromText('بدي أعمل أشعة أسنان');
    expect(out).toBe('أشعة');
  });

  it('extracts تنظيف أسنان / فحص أسنان', () => {
    expect(extractRequestedServiceFromText('بدي تنظيف أسنان')).toBe('تنظيف');
    expect(extractRequestedServiceFromText('أريد فحص أسنان')).toBe('فحص');
  });

  it('extracts علاج عصب', () => {
    expect(extractRequestedServiceFromText('بدي علاج عصب')).toBe('علاج عصب');
  });

  it('does NOT treat a bare medical mention as a booking desire', () => {
    expect(extractRequestedServiceFromText('هل الأشعة خطيرة؟')).toBeNull();
    expect(extractRequestedServiceFromText('الدكتور طلب مني أشعة')).toBeNull();
    expect(extractRequestedServiceFromText('مرحبا شو اخبارك')).toBeNull();
    expect(extractRequestedServiceFromText('عندي ألم بضرس')).toBeNull();
  });
});