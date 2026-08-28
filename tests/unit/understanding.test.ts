/**
 * STEP 2 — Understanding Layer tests (deterministic, injectable clock).
 */
import { describe, expect, it } from 'vitest';
import {
  understandMessage,
  applyUnderstandingToState,
  extractRequestedService,
  extractPreferredProvider,
  extractTimeOptions,
  extractPatientLocation,
  extractBookingIntent,
  extractPatientSymptoms,
  extractPreferredDate,
  extractPreferredTimeRange,
  dateInTimeZone,
  addDaysIso,
} from '@/lib/ai/understanding';
import type { ReceptionistConversationState } from '@/lib/ai/clinicDataContext';

const NOW = new Date('2026-08-27T10:00:00.000Z'); // Asia/Jerusalem → 2026-08-27 13:00 local
const TZ = 'Asia/Jerusalem';

function baseState(): ReceptionistConversationState {
  return {
    state: 'DISCOVERING_PROBLEM',
    recommended_service_id: null,
    recommended_provider_id: null,
    patient_confirmed_booking: false,
    pending_question: '',
    booking: { service_id: null, provider_id: null, slot: null, patient_name: null, phone: null, email: null },
  };
}

describe('service extraction', () => {
  it('extracts فحص أسنان from "بدي فحص أسنان"', () => {
    expect(extractRequestedService('بدي فحص أسنان')).toBe('فحص أسنان');
  });
  it('extracts تنظيف أسنان from "بدي تنظيف"', () => {
    expect(extractRequestedService('بدي تنظيف')).toBe('تنظيف أسنان');
  });
  it('extracts أشعة أسنان from "بدي أشعة"', () => {
    expect(extractRequestedService('بدي أشعة')).toBe('أشعة أسنان');
  });
});

describe('provider extraction', () => {
  it('extracts provider name only (no id)', () => {
    expect(extractPreferredProvider('بدي فحص مع سارة')).toBe('سارة');
    expect(extractPreferredProvider('بدي موعد مع د. أحمد')).toBe('أحمد');
  });
  it('returns undefined when no provider mentioned', () => {
    expect(extractPreferredProvider('بدي فحص أسنان')).toBeUndefined();
  });
});

describe('date extraction (clinic timezone)', () => {
  it('اليوم → today in Asia/Jerusalem', () => {
    expect(extractPreferredDate('بدي دكتور اليوم', NOW, TZ)).toBe('2026-08-27');
  });
  it('بكرة → tomorrow', () => {
    expect(extractPreferredDate('بدي موعد بكرة', NOW, TZ)).toBe('2026-08-28');
  });
  it('بعد بكرة → day after tomorrow', () => {
    expect(extractPreferredDate('بدي بعد بكرة', NOW, TZ)).toBe('2026-08-29');
  });
  it('dateInTimeZone + addDaysIso are deterministic', () => {
    expect(dateInTimeZone(NOW, TZ)).toBe('2026-08-27');
    expect(addDaysIso('2026-08-27', 1)).toBe('2026-08-28');
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
  });
});


describe('time range extraction (constraints, not slots)', () => {
  it('اليوم بعد الظهر → date + range {12:00,17:00}', () => {
    const r = understandMessage('اليوم بعد الظهر', { now: NOW, timeZone: TZ });
    expect(r.preferred_date).toBe('2026-08-27');
    expect(r.preferred_time_range).toEqual({ from: '12:00', to: '17:00' });
  });
  it('بعد الساعة 3 → from 15:00', () => {
    expect(extractPreferredTimeRange('بعد الساعة 3')).toEqual({ from: '15:00', to: '23:59' });
  });
  it('من 1 للـ4 → 13:00-16:00', () => {
    expect(extractPreferredTimeRange('من 1 للـ4')).toEqual({ from: '13:00', to: '16:00' });
  });
  it('العصر → range not fixed slot', () => {
    const r = understandMessage('بدي موعد العصر', { now: NOW, timeZone: TZ });
    expect(r.preferred_time_range).toEqual({ from: '15:00', to: '18:00' });
    expect(r.preferred_time_options).toBeUndefined();
  });
  it('1 أو 4 → two options, not a single slot', () => {
    expect(extractTimeOptions('1 أو 4')).toEqual(['13:00', '16:00']);
    expect(extractTimeOptions('الساعة 1 أو 4')).toEqual(['13:00', '16:00']);
  });
});

describe('booking intent', () => {
  it('بدي أحجز → true', () => {
    expect(extractBookingIntent('بدي أحجز موعد')).toBe(true);
  });
  it('شو في مواعيد؟ → true', () => {
    expect(extractBookingIntent('شو في مواعيد؟')).toBe(true);
  });
  it('كم سعر التنظيف؟ → NOT booking', () => {
    expect(extractBookingIntent('كم سعر التنظيف؟')).toBeUndefined();
  });
  it('وين العيادة؟ → NOT booking', () => {
    expect(extractBookingIntent('وين العيادة؟')).toBeUndefined();
  });
});

describe('patient symptoms (faithful, no diagnosis)', () => {
  it('keeps the patient\'s words and never produces a diagnosis field', () => {
    const r = understandMessage('عندي وجع زي الكهربا لما أشرب سخن', { now: NOW, timeZone: TZ });
    expect(r.patient_reported_symptoms).toContain('وجع زي الكهربا');
    expect('diagnosis' in r).toBe(false);
  });
  it('no symptom keywords → undefined', () => {
    expect(extractPatientSymptoms('بدي فحص أسنان')).toBeUndefined();
  });
});

describe('patient location (never clinic location)', () => {
  it('أنا في رام الله → patient_location.city', () => {
    const r = understandMessage('أنا في رام الله', { now: NOW, timeZone: TZ });
    expect(r.patient_location).toEqual({ city: 'رام الله', source: 'conversation' });
  });
  it('ساكن في نابلس → نابلس', () => {
    expect(extractPatientLocation('ساكن في نابلس')).toEqual({ city: 'نابلس', source: 'conversation' });
  });
  it('no location mentioned → undefined (never invented)', () => {
    expect(extractPatientLocation('بدي فحص أسنان')).toBeUndefined();
  });
});

describe('state merge semantics', () => {
  it('keeps previous state when new message has no new value', () => {
    const state = { ...baseState(), requested_service: 'فحص أسنان', preferred_provider: 'سارة' };
    const result = understandMessage('اليوم بعد الظهر', { now: NOW, timeZone: TZ });
    const next = applyUnderstandingToState(state, result);
    expect(next.requested_service).toBe('فحص أسنان');
    expect(next.preferred_provider).toBe('سارة');
    expect(next.preferred_date).toBe('2026-08-27');
  });

  it('updates a previously stored value when patient corrects it', () => {
    const state = { ...baseState(), requested_service: 'فحص أسنان' };
    const next = applyUnderstandingToState(state, { requested_service: 'تنظيف أسنان' });
    expect(next.requested_service).toBe('تنظيف أسنان');
  });

  it('never creates provider/service IDs', () => {
    const r = understandMessage('بدي فحص مع سارة', { now: NOW, timeZone: TZ });
    expect(r.requested_service).toBe('فحص أسنان');
    expect(r.preferred_provider).toBe('سارة');
    expect((r as any).provider_id).toBeUndefined();
    expect((r as any).service_id).toBeUndefined();
  });

  it('patient_location never becomes clinic_location', () => {
    const state = { ...baseState() };
    const next = applyUnderstandingToState(state, { patient_location: { city: 'رام الله', source: 'conversation' } });
    expect(next.patient_location?.city).toBe('رام الله');
    expect((next as any).clinic_location).toBeUndefined();
  });
});
