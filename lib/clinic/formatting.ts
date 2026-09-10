/**
 * Localization Foundation — centralized formatting (D-L4).
 *
 * A single home for currency / number / date display formatting so every
 * clinic UI renders consistently from clinic_settings (currency, locale,
 * number_format, date_format). No full i18n framework (D7) — this is the
 * ar/en display layer only.
 *
 * Platform Billing keeps its own display path (single platform currency);
 * these helpers are clinic-side and generic enough to reuse everywhere.
 */

export type DisplayLocale = 'ar' | 'en';

const INTL_LOCALE: Record<DisplayLocale, string> = { ar: 'ar-EG', en: 'en-US' };

/** Maps an ISO-4217 code to a readable label (ar/en). */
export function currencyLabel(currency: string, locale: DisplayLocale = 'ar'): string {
  const upper = currency.toUpperCase();
  const labels: Record<string, Record<DisplayLocale, string>> = {
    ILS: { ar: 'شيكل', en: 'ILS' },
    JOD: { ar: 'دينار أردني', en: 'JOD' },
    SAR: { ar: 'ريال سعودي', en: 'SAR' },
    KWD: { ar: 'دينار كويتي', en: 'KWD' },
    AED: { ar: 'درهم إماراتي', en: 'AED' },
    USD: { ar: 'دولار', en: 'USD' },
  };
  return labels[upper]?.[locale] ?? upper;
}

/** Formats a major-unit money amount (e.g. 120.5 ILS → "120.50 شيكل" or "₪120.50"). */
export function formatMoney(
  amount: number,
  currency: string,
  locale: DisplayLocale = 'ar'
): string {
  if (!Number.isFinite(amount)) return '—';
  const upper = currency.toUpperCase();
  try {
    if (locale === 'ar') {
      const formatted = new Intl.NumberFormat('ar-EG', {
        style: 'currency',
        currency: upper,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(amount);
      // Arabic-Indic digits are faithful to locale; keep the label explicit for clarity.
      return formatted;
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: upper,
      currencyDisplay: 'code',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for currencies Intl cannot resolve (e.g. 'ils' in some runtimes).
    const numeric = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
    return locale === 'ar' ? `${numeric} ${currencyLabel(upper, 'ar')}` : `${numeric} ${upper}`;
  }
}

/** Formats a plain number using the clinic number_format. */
export function formatNumber(value: number, numberFormat: 'en' | 'ar' = 'en'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(numberFormat === 'ar' ? 'ar-EG' : 'en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats an ISO date (YYYY-MM-DD) / Date / ISO string into the configured
 * date_format for the locale. Supported display tokens (kept scope-minimal):
 *   YYYY-MM-DD (default), DD/MM/YYYY, YYYY/MM/DD.
 * Anything outside this set falls back to the input ISO date, unchanged.
 */
export function formatDate(
  input: string | Date,
  dateFormat: string = 'YYYY-MM-DD',
  locale: DisplayLocale = 'ar'
): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return String(input);

  const yy = String(date.getFullYear());
  let mm = String(date.getMonth() + 1);
  let dd = String(date.getDate());
  if (dateFormat === 'DD/MM/YYYY') {
    return locale === 'ar' ? `${dd}/${mm}/${yy}` : `${dd}/${mm}/${yy}`;
  }
  if (dateFormat === 'YYYY/MM/DD') {
    return `${yy}/${mm}/${dd}`;
  }
  // Default YYYY-MM-DD — always zero-padded for machine-safe display.
  mm = mm.padStart(2, '0');
  dd = dd.padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Labels the fiscal_year configuration (D-L5): calendar (default) vs custom. */
export function fiscalYearLabel(fiscalYear: 'calendar' | 'custom', locale: DisplayLocale = 'ar'): string {
  if (fiscalYear === 'custom') return locale === 'ar' ? 'سنة مالية مخصصة' : 'Custom fiscal year';
  return locale === 'ar' ? 'سنة تقويمية' : 'Calendar year';
}