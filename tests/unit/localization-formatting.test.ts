import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatNumber,
  formatDate,
  currencyLabel,
  fiscalYearLabel,
} from '@/lib/clinic/formatting';

describe('formatMoney (D-L4 centralized formatting)', () => {
  it('formats ILS in Arabic with narrow symbol (ar-EG renders Arabic-Indic digits)', () => {
    const s = formatMoney(120.5, 'ILS', 'ar');
    expect(s.length).toBeGreaterThan(0);
    // ar-EG locale renders Arabic-Indic digits — faithful locale output (D-L4).
    expect(s).toContain('١٢٠');
    expect(s).toContain('₪');
  });

  it('formats in English with code display', () => {
    // en path uses currencyDisplay:'code' → the ISO code appears.
    expect(formatMoney(120.5, 'ILS', 'en')).toContain('ILS');
  });

  it('normalises lowercase currency codes to resolvable ISO upper', () => {
    // 'ils' is upper-cased internally → ILS resolves; ar-EG renders Arabic digits.
    const s = formatMoney(100, 'ils', 'ar');
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain('١٠٠');
  });

  it('returns a dash for non-finite input', () => {
    expect(formatMoney(Number.NaN, 'ILS', 'ar')).toBe('—');
  });
});

describe('formatNumber (D-L4)', () => {
  it('formats plain numbers for en and ar', () => {
    // en-US groups thousands → '1,234.5'.
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'ar').length).toBeGreaterThan(0);
  });
  it('returns a dash for non-finite input', () => {
    expect(formatNumber(Number.NaN)).toBe('—');
  });
});

describe('formatDate (D-L4)', () => {
  it('defaults to YYYY-MM-DD', () => {
    expect(formatDate('2026-09-01')).toBe('2026-09-01');
  });
  it('supports DD/MM/YYYY and YYYY/MM/DD tokens', () => {
    expect(formatDate('2026-09-01', 'DD/MM/YYYY')).toBe('1/9/2026');
    expect(formatDate('2026-09-01', 'YYYY/MM/DD')).toBe('2026/9/1');
  });
  it('returns the input unchanged when unparseable', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('currencyLabel / fiscalYearLabel (D-L4/D-L5)', () => {
  it('labels known currencies in Arabic/English', () => {
    expect(currencyLabel('ILS', 'ar')).toBe('شيكل');
    expect(currencyLabel('SAR', 'ar')).toBe('ريال سعودي');
    expect(currencyLabel('XYZ', 'ar')).toBe('XYZ');
  });
  it('labels fiscal year config', () => {
    expect(fiscalYearLabel('calendar', 'ar')).toContain('تقويمية');
    expect(fiscalYearLabel('custom', 'en')).toBe('Custom fiscal year');
  });
});