/**
 * Localization Foundation — server-side helpers (D-L2/D-L4/D-L5).
 *
 * - Validate IANA timezones (no silent bad-zone storage).
 * - Map known markets (free-text country from registration/profile) to the
 *   country_profiles codes so per-clinic defaults are country-aware.
 * - Load/upsert clinic_settings with a documented transition fallback to the
 *   legacy clinics.settings.timezone JSONB key (D-L2 compatibility).
 *
 * Platform Billing (billing_plans/subscriptions/Stripe) is never touched.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export const LOCALIZATION_DEFAULTS = {
  currency: 'ils',
  timezone: 'UTC',
  locale: 'ar',
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'en',
  fiscalYear: 'calendar',
} as const;

/** Known markets: free-text country -> country_profiles.code. */
export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  PS: 'PS',
  Palestine: 'PS',
  'فلسطين': 'PS',
  JO: 'JO',
  Jordan: 'JO',
  'الأردن': 'JO',
  SA: 'SA',
  'Saudi Arabia': 'SA',
  'السعودية': 'SA',
  KW: 'KW',
  Kuwait: 'KW',
  'الكويت': 'KW',
  AE: 'AE',
  UAE: 'AE',
  'United Arab Emirates': 'AE',
  'الإمارات': 'AE',
  'الإمارات العربية المتحدة': 'AE',
};

/** Normalises a free-text country value to a country_profiles code (or null). */
export function countryToCode(country?: string | null): string | null {
  if (!country) return null;
  const key = country.trim();
  if (!key) return null;
  if (/^[A-Z]{2}$/.test(key)) return COUNTRY_NAME_TO_CODE[key] ?? key.toUpperCase();
  const matched = COUNTRY_NAME_TO_CODE[key] ?? COUNTRY_NAME_TO_CODE[key.toLowerCase()];
  return matched ?? null;
}

/** True when the value is a valid IANA timezone name (via Intl). */
export function validateIanaTimezone(timezone?: string | null): boolean {
  if (!timezone) return true; // null/empty is "not provided", not invalid
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export type CountryProfile = {
  code: string;
  name: string;
  nameAr: string;
  currency: string;
  locale: string;
  defaultTimezone: string;
  dateFormat: string;
  numberFormat: string;
};

/** Fetches a country_profiles row by code (or null). */
export async function fetchCountryProfile(code: string | null): Promise<CountryProfile | null> {
  if (!code) return null;
  const { data, error } = await supabaseAdmin
    .from('country_profiles')
    .select('code, name, name_ar, currency, locale, default_timezone, date_format, number_format')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) {
    if (error) logEvent('localization_country_profile_lookup_error', { code, error: error.message }, 'error');
    return null;
  }
  return {
    code: data.code,
    name: data.name,
    nameAr: data.name_ar,
    currency: data.currency,
    locale: data.locale,
    defaultTimezone: data.default_timezone,
    dateFormat: data.date_format,
    numberFormat: data.number_format,
  };
}

export type ClinicLocalizationSettings = {
  currency: string;
  timezone: string;
  locale: 'ar' | 'en';
  dateFormat: string;
  numberFormat: 'en' | 'ar';
  fiscalYear: 'calendar' | 'custom';
};

/**
 * Loads a clinic's localization settings. Source of truth: clinic_settings.
 * Transition fallback (D-L2): when no clinic_settings row exists yet, read
 * the legacy clinics.settings.timezone JSONB key and merge the rest from the
 * safe defaults — nothing breaks for clinics created before this migration.
 */
export async function loadClinicLocalization(clinicId: string): Promise<ClinicLocalizationSettings> {
  const { data, error } = await supabaseAdmin
    .from('clinic_settings')
    .select('currency, timezone, locale, date_format, number_format, fiscal_year')
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (error) {
    logEvent('localization_settings_load_error', { clinic_id: clinicId, error: error.message }, 'error');
  }

  if (data) {
    return {
      currency: data.currency || LOCALIZATION_DEFAULTS.currency,
      timezone: data.timezone || LOCALIZATION_DEFAULTS.timezone,
      locale: data.locale === 'en' ? 'en' : 'ar',
      dateFormat: data.date_format || LOCALIZATION_DEFAULTS.dateFormat,
      numberFormat: data.number_format === 'ar' ? 'ar' : 'en',
      fiscalYear: data.fiscal_year === 'custom' ? 'custom' : 'calendar',
    };
  }

  // Transition fallback: legacy clinics.settings.timezone key (no row yet).
  try {
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();
    const legacyTz = ((clinic?.settings ?? {}) as Record<string, unknown>)?.timezone as string | null;
    return {
      ...LOCALIZATION_DEFAULTS,
      timezone: validateIanaTimezone(legacyTz) && legacyTz ? legacyTz : LOCALIZATION_DEFAULTS.timezone,
    };
  } catch {
    return { ...LOCALIZATION_DEFAULTS };
  }
}

/** Upserts a clinic_settings row (insert or full-field update). */
export async function upsertClinicLocalization(
  clinicId: string,
  patch: Partial<ClinicLocalizationSettings>
): Promise<void> {
  const row = {
    clinic_id: clinicId,
    currency: patch.currency ?? LOCALIZATION_DEFAULTS.currency,
    timezone: patch.timezone ?? LOCALIZATION_DEFAULTS.timezone,
    locale: patch.locale ?? LOCALIZATION_DEFAULTS.locale,
    date_format: patch.dateFormat ?? LOCALIZATION_DEFAULTS.dateFormat,
    number_format: patch.numberFormat ?? LOCALIZATION_DEFAULTS.numberFormat,
    fiscal_year: patch.fiscalYear ?? LOCALIZATION_DEFAULTS.fiscalYear,
  };
  if (!validateIanaTimezone(row.timezone)) {
    throw new Error('INVALID_TIMEZONE');
  }
  const { error } = await supabaseAdmin.from('clinic_settings').upsert(row, { onConflict: 'clinic_id' });
  if (error) {
    logEvent('localization_settings_upsert_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
}