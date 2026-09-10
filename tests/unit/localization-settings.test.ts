import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockAdmin = vi.hoisted(() => {
  const makeChain = (result: { data: unknown; error: unknown } = { data: null, error: null }) => {
    const chain: Record<string, any> = {};
    for (const m of ['select', 'eq', 'is', 'maybeSingle', 'upsert']) chain[m] = vi.fn(() => chain);
    chain.then = (onOk: any, onErr: any) => Promise.resolve(result).then(onOk, onErr);
    return chain;
  };
  const from = vi.fn(() => makeChain());
  return { supabaseAdmin: { from }, __makeChain: makeChain };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockAdmin.supabaseAdmin }));

import {
  LOCALIZATION_DEFAULTS,
  COUNTRY_NAME_TO_CODE,
  countryToCode,
  validateIanaTimezone,
  loadClinicLocalization,
  upsertClinicLocalization,
} from '@/lib/clinic/localization';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.supabaseAdmin.from.mockReset().mockReturnValue(mockAdmin.__makeChain());
});

describe('countryToCode (D-L2 country-aware mapping)', () => {
  it('maps Arabic, English, and code forms to country_profiles codes', () => {
    expect(countryToCode('فلسطين')).toBe('PS');
    expect(countryToCode('Palestine')).toBe('PS');
    expect(countryToCode('PS')).toBe('PS');
    expect(countryToCode('الأردن')).toBe('JO');
    expect(countryToCode('السعودية')).toBe('SA');
    expect(countryToCode('الكويت')).toBe('KW');
    expect(countryToCode('الإمارات')).toBe('AE');
  });
  it('returns null for unknown/empty input', () => {
    expect(countryToCode('Mars')).toBeNull();
    expect(countryToCode(null)).toBeNull();
    expect(countryToCode('  ')).toBeNull();
  });
  it('exposes the mapping constants for reuse', () => {
    expect(COUNTRY_NAME_TO_CODE['فلسطين']).toBe('PS');
  });
});

describe('validateIanaTimezone (D-L2)', () => {
  it('accepts real IANA zones and rejects garbage', () => {
    expect(validateIanaTimezone('Asia/Jerusalem')).toBe(true);
    expect(validateIanaTimezone('Asia/Amman')).toBe(true);
    expect(validateIanaTimezone('Mars/Olympus')).toBe(false);
    expect(validateIanaTimezone('')).toBe(true); // null/empty = not provided
    expect(validateIanaTimezone(null)).toBe(true);
  });
});

describe('loadClinicLocalization (D-L2 source of truth + transition fallback)', () => {
  it('prefers clinic_settings when a row exists', async () => {
    mockAdmin.supabaseAdmin.from.mockReturnValue(mockAdmin.__makeChain({
      data: { currency: 'jod', timezone: 'Asia/Amman', locale: 'ar', date_format: 'YYYY-MM-DD', number_format: 'en', fiscal_year: 'calendar' },
      error: null,
    }));
    const s = await loadClinicLocalization(CLINIC_A);
    expect(s.currency).toBe('jod');
    expect(s.timezone).toBe('Asia/Amman');
    expect(s.locale).toBe('ar');
  });

  it('falls back to the legacy clinics.settings.timezone JSONB when no row', async () => {
    const from = mockAdmin.supabaseAdmin.from;
    from.mockImplementation((table?: string) =>
      // first call is clinic_settings (no row); second call is clinics (legacy)
      mockAdmin.__makeChain(
        table === 'clinics'
          ? { data: { settings: { timezone: 'Asia/Jerusalem' } }, error: null }
          : { data: null, error: null }
      )
    );
    const s = await loadClinicLocalization(CLINIC_A);
    expect(s.timezone).toBe('Asia/Jerusalem');
    expect(s.currency).toBe(LOCALIZATION_DEFAULTS.currency);
  });

  it('uses the safe UTC default when nothing is configured', async () => {
    const s = await loadClinicLocalization(CLINIC_A);
    expect(s.timezone).toBe('UTC');
    expect(s.fiscalYear).toBe('calendar');
  });
});

describe('upsertClinicLocalization (D-L2 validation at write)', () => {
  it('throws INVALID_TIMEZONE for a bad IANA value before touching the DB', async () => {
    mockAdmin.supabaseAdmin.from.mockReturnValue(mockAdmin.__makeChain({ data: null, error: null }));
    await expect(
      upsertClinicLocalization(CLINIC_A, { timezone: 'Mars/Olympus' })
    ).rejects.toThrow('INVALID_TIMEZONE');
  });

  it('upserts a valid row scoped by clinic_id', async () => {
    mockAdmin.supabaseAdmin.from.mockReturnValue(mockAdmin.__makeChain({ data: [{}], error: null }));
    await upsertClinicLocalization(CLINIC_A, { timezone: 'Asia/Amman', currency: 'jod' });
    const chain = mockAdmin.supabaseAdmin.from.mock.results[0]?.value;
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ clinic_id: CLINIC_A, timezone: 'Asia/Amman', currency: 'jod' }),
      { onConflict: 'clinic_id' }
    );
  });
});