import { z } from 'zod';
import type { ReceptionistConversationState } from '@/lib/ai/clinicDataContext';

/**
 * STEP 2 — Understanding Layer (deterministic, no LLM).
 *
 * Converts a user message into a STRUCTURED UnderstandingResult. This layer
 * only extracts MEANING from natural (Arabic/Palestinian) language. It never:
 *  - invents provider/service/clinic IDs (resolution happens in STEP 3),
 *  - decides or computes availability (STEP 3),
 *  - creates appointments,
 *  - treats patient_location as clinic_location.
 *
 * All date/time logic uses an injectable clock + clinic IANA timezone so tests
 * are deterministic and past/future boundaries are computed in the RIGHT zone.
 */

export const understandingResultSchema = z.object({
  requested_service: z.string().max(200).optional(),
  preferred_provider: z.string().max(200).optional(),
  /** ISO date YYYY-MM-DD in the clinic timezone. */
  preferred_date: z.string().max(20).optional(),
  preferred_time_range: z.object({ from: z.string(), to: z.string() }).optional(),
  /** "1 أو 4" → ["13:00","16:00"] — constraints only, never invented slots. */
  preferred_time_options: z.array(z.string().max(5)).optional(),
  /** Faithful record of the patient's own words — NOT a diagnosis. */
  patient_reported_symptoms: z.string().max(2000).optional(),
  booking_intent: z.boolean().optional(),
  patient_location: z
    .object({
      city: z.string().max(120).optional(),
      region: z.string().max(120).optional(),
      source: z.enum(['conversation', 'user_selected', 'shared_location']).optional(),
    })
    .optional(),
  network_discovery_agreed: z.boolean().optional(),
  selected_clinic: z
    .object({ id: z.string().min(1), slug: z.string().min(1), name: z.string().min(1) })
    .optional(),
});

export type UnderstandingResult = z.infer<typeof understandingResultSchema>;

/** Defaults for common time-of-day periods — configurable, not scattered hard-codes. */
export const TIME_PERIODS: Record<string, { from: string; to: string }> = {
  'الصبح': { from: '08:00', to: '12:00' },
  'الظهر': { from: '12:00', to: '15:00' },
  'بعد الظهر': { from: '12:00', to: '17:00' },
  'العصر': { from: '15:00', to: '18:00' },
  'المسا': { from: '17:00', to: '21:00' },
  'المساء': { from: '17:00', to: '21:00' },
};

/** Normalise Arabic digits to Latin (e.g. "٣" → "3"). */
function toLatinDigits(input: string): string {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  return input.replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
}

/** Clinic-local date (YYYY-MM-DD) for an instant, using the IANA zone. */
export function dateInTimeZone(now: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(now); // en-CA → YYYY-MM-DD
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Clinic-local wall-clock time (HH:MM) for an instant, using the IANA zone. */
export function timeInTimeZone(now: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const s = fmt.format(now); // en-GB → "HH:MM" (24h)
    return s === '24:00' ? '00:00' : s;
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

/** Adds whole days to a YYYY-MM-DD string (calendar-safe via UTC noon). */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SERVICES: Array<{ re: RegExp; label: string }> = [
  { re: /تنظيف\s*(الأسنان)?|تنضيف/i, label: 'تنظيف أسنان' },
  { re: /فحص\s*(الأسنان)?|كشف/i, label: 'فحص أسنان' },
  { re: /أشعة|اشعة|رنين|صورة أسنان/i, label: 'أشعة أسنان' },
  { re: /تبييض|تلميع/i, label: 'تبييض أسنان' },
  { re: /زراعة|زرع/i, label: 'زراعة أسنان' },
  { re: /تقويم/i, label: 'تقويم أسنان' },
  { re: /حشو|حشوة/i, label: 'حشو الأسنان' },
  { re: /خلع|قلع/i, label: 'خلع الأسنان' },
  { re: /علاج\s*العصب|سحب عصب/i, label: 'علاج العصب' },
  { re: /جسر|تركيب أسنان|طربوش/i, label: 'تركيب جسر' },
];

/** Extracts a requested service NAME only (no IDs — resolved later). */
export function extractRequestedService(text: string): string | undefined {
  const t = toLatinDigits(text);
  for (const { re, label } of SERVICES) {
    if (re.test(t)) return label;
  }
  return undefined;
}

const NAMES = ['سارة', 'أحمد', 'محمد', 'خالد', 'سامر', 'رنا', 'نور', 'هدى', 'ليان', 'عمر', 'يوسف'];

/** Extracts a provider PREFERENCE (name only; matched against real providers later). */
export function extractPreferredProvider(text: string): string | undefined {
  const t = text.trim();
  const patterns = [
    /مع\s+(?:الدكتور|الدكتورة|د\.|د\s)?\s*([\u0600-\u06FF]{2,30})/i,
    /بدي\s+(?:الدكتور|الدكتورة|د\.|د\s)\s*([\u0600-\u06FF]{2,30})/i,
    /الدكتور\s*([\u0600-\u06FF]{2,30})/i,
    /الدكتورة\s*([\u0600-\u06FF]{2,30})/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const name = (m[1] ?? '').trim().replace(/[،.؟!]$/, '');
      if (name) return name;
    }
  }
  // Bare first-name preference: "بدي سارة" / "مع سارة"
  for (const n of NAMES) {
    if (new RegExp(`(?:بدي|مع|عند)\s*${n}`, 'i').test(t)) return n;
  }
  return undefined;
}

/** Extracts "اليوم"/"بكرة"/"بعد بكرة" → clinic-local ISO date. */
export function extractPreferredDate(text: string, now: Date, timeZone: string): string | undefined {
  const t = toLatinDigits(text);
  const today = dateInTimeZone(now, timeZone);
  if (/بعد\s*بكرة|بعد\s*بكره/.test(t)) return addDaysIso(today, 2);
  if (/بكرة|بكره|غدا|غداً/.test(t)) return addDaysIso(today, 1);
  if (/اليوم/.test(t)) return today;
  return undefined;
}

function hourTo24h(h: string, forceAfternoon = true): string | undefined {
  const n = Number(h);
  if (!Number.isInteger(n) || n < 1 || n > 12) return undefined;
  return padHour(forceAfternoon ? String(n + 12) : String(n));
}

function padHour(h: string): string {
  return h.padStart(2, '0') + ':00';
}

/** "من 1 للـ4" / "بين 1 و4" → {from:"13:00", to:"16:00"}. */
/** "من 1 للـ4" / "بين 1 و4" → {from:"13:00", to:"16:00"}. */
function extractBoundedRange(t: string): { from: string; to: string } | undefined {
  // The tatweel after لـ is \u0640. Accept both "لـ4" and "ل 4" and plain "الى".
  const m = t.match(/(?:من|بين)\s+(?:الساعة|الساعه)?\s*(\d{1,2})\s*(?:لل[\u0640]?|ل[\u0640]?|الى|إلى|لحد|وحتى|و|الي)\s*(?:الساعة|الساعه)?\s*(\d{1,2})/i);
  if (!m) return undefined;
  const from = hourTo24h(m[1]);
  const to = hourTo24h(m[2]);
  if (!from || !to || from >= to) return undefined;
  return { from, to };
}

/** "بعد الساعة 3" → {from:"15:00"}; "قبل 5" → {to:"17:00"}. */
function extractAfterBefore(t: string): { from?: string; to?: string } | undefined {
  const after = t.match(/بعد\s+(?:الساعة|الساعه)?\s*(\d{1,2})/i);
  if (after) {
    const h = hourTo24h(after[1]);
    if (h) return { from: h };
  }
  const before = t.match(/قبل\s+(?:الساعة|الساعه)?\s*(\d{1,2})/i);
  if (before) {
    const h = hourTo24h(before[1]);
    if (h) return { to: h };
  }
  return undefined;
}

/** "1 أو 4" / "الساعة 1 أو 4" → ["13:00","16:00"]. */
export function extractTimeOptions(text: string): string[] | undefined {
  const t = toLatinDigits(text);
  const m = t.match(/(?:الساعة|الساعه)?\s*(\d{1,2})\s*(?:أو|او|ولا)\s*(\d{1,2})/i);
  if (!m) return undefined;
  const a = hourTo24h(m[1]);
  const b = hourTo24h(m[2]);
  if (!a || !b) return undefined;
  return [a, b];
}

/** Extracts a time range (constraint, not a slot). */
export function extractPreferredTimeRange(text: string): { from: string; to: string } | undefined {
  const t = toLatinDigits(text);
  const bounded = extractBoundedRange(t);
  if (bounded) return bounded;
  const afterBefore = extractAfterBefore(t);
  if (afterBefore && (afterBefore.from || afterBefore.to)) {
    return { from: afterBefore.from ?? '00:00', to: afterBefore.to ?? '23:59' };
  }
  // Longer phrases first so "بعد الظهر" doesn't match the bare "الظهر".
  const ordered = Object.entries(TIME_PERIODS).sort((a, b) => b[0].length - a[0].length);
  for (const [period, range] of ordered) {
    if (t.includes(period)) return range;
  }
  return undefined;
}

const BOOKING_INTENT_RE = /بدي\s*[أا]حجز|بدي\s*حجز|بدي\s*موعد|أحجزلي|احجزلي|احجز\s*لي|اريد\s*[أا]حجز|أريد\s*[أا]حجز|ابدي\s*[أا]حجز|شو\s*في\s*مواعيد|شو\s*فيه\s*مواعيد|عندكم\s*مواعيد|ممكن\s*(أحجز|احجز|موعد)/i;
const NOT_BOOKING_RE = /كم\s*سعر|سعر\s*التنظيف|شو\s*الأسعار|وين\s*العيادة|ساعات\s*الدوام|أوقات\s*الدوام|عنوانكم|رقم\s*الهاتف|هل\s*الزراعة|فيها\s*ألم|هل\s*في\s*ألم/i;

export function extractBookingIntent(text: string): boolean | undefined {
  const t = toLatinDigits(text);
  if (NOT_BOOKING_RE.test(t)) return undefined;
  if (BOOKING_INTENT_RE.test(t)) return true;
  return undefined;
}

const SYMPTOM_RE = /وجع|ألم|الم|بتوجعني|بتجعني|بوجعني|يؤلم|حساسية|تعبان|انتفاخ|تورم|نزيف|مكسور|خربان|سخن|بارد|عندي\s*ألم/i;

/** Faithful record of the patient's words — never a diagnosis. */
export function extractPatientSymptoms(text: string): string | undefined {
  if (SYMPTOM_RE.test(text)) {
    return text.trim().replace(/\s+/g, ' ').slice(0, 2000);
  }
  return undefined;
}

const LOCATION_KEYWORDS: Array<RegExp> = [
  /(?:أنا|انا)\s+في\s+([\u0600-\u06FF\s]{2,40}?)(?=[،.؟!]|$)/i,
  /ساكن\s+في\s+([\u0600-\u06FF\s]{2,40}?)(?=[،.؟!]|$)/i,
  /اسكن\s+في\s+([\u0600-\u06FF\s]{2,40}?)(?=[،.؟!]|$)/i,
  /(?:أنا|انا)\s+من\s+([\u0600-\u06FF\s]{2,40}?)(?=[،.؟!]|$)/i,
  /من\s+([\u0600-\u06FF]{3,30}?)(?=[،.؟!]|$)/i,
];

/** Extracts PATIENT-side location only. NEVER clinic location. */
export function extractPatientLocation(text: string): UnderstandingResult['patient_location'] | undefined {
  const t = text.trim();
  for (const re of LOCATION_KEYWORDS) {
    const m = t.match(re);
    if (m && m[1]) {
      const city = m[1].trim().replace(/\s+/g, ' ').slice(0, 120);
      if (city) return { city, source: 'conversation' };
    }
  }
  return undefined;
}

const NETWORK_DISCOVERY_RE = /بدي\s*عيادة|بدي\s*بديل|أقرب\s*عيادة|قريبة\s*عيادة|وين\s*في\s*عيادة|عندكم\s*فرع|عيادة\s*ثانية|عيادة\s*تانية|مكان\s*ثاني/i;

export function extractNetworkDiscoveryAgreed(text: string): boolean | undefined {
  return NETWORK_DISCOVERY_RE.test(text) ? true : undefined;
}

export type UnderstandingOptions = {
  /** Injectable clock — tests pass a fixed Date to stay deterministic. */
  now?: Date;
  /** Clinic IANA timezone (e.g. "Asia/Jerusalem"). Defaults to UTC only when unknown. */
  timeZone?: string;
};

/** Main entry: parse one user message into a structured, validated result. */
export function understandMessage(text: string, options: UnderstandingOptions = {}): UnderstandingResult {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? 'UTC';

  const requested_service = extractRequestedService(text);
  const preferred_provider = extractPreferredProvider(text);
  const preferred_date = extractPreferredDate(text, now, timeZone);
  const preferred_time_range = extractPreferredTimeRange(text);
  const preferred_time_options = extractTimeOptions(text);
  const patient_reported_symptoms = extractPatientSymptoms(text);
  const booking_intent = extractBookingIntent(text);
  const patient_location = extractPatientLocation(text);
  const network_discovery_agreed = extractNetworkDiscoveryAgreed(text);

  const parsed = understandingResultSchema.safeParse({
    ...(requested_service ? { requested_service } : {}),
    ...(preferred_provider ? { preferred_provider } : {}),
    ...(preferred_date ? { preferred_date } : {}),
    ...(preferred_time_range ? { preferred_time_range } : {}),
    ...(preferred_time_options ? { preferred_time_options } : {}),
    ...(patient_reported_symptoms ? { patient_reported_symptoms } : {}),
    ...(booking_intent !== undefined ? { booking_intent } : {}),
    ...(patient_location ? { patient_location } : {}),
    ...(network_discovery_agreed !== undefined ? { network_discovery_agreed } : {}),
  });

  return parsed.success ? parsed.data : {};
}

/**
 * Merges an UnderstandingResult INTO the existing ReceptionistConversationState.
 * Patch semantics: only fields present in the result overwrite; everything else
 * is preserved (never cleared). When the patient corrects a value, the new value
 * replaces the old one.
 */
export function applyUnderstandingToState(
  state: ReceptionistConversationState,
  result: UnderstandingResult
): ReceptionistConversationState {
  const next: ReceptionistConversationState = { ...state };

  if (result.requested_service) next.requested_service = result.requested_service;
  if (result.preferred_provider) next.preferred_provider = result.preferred_provider;
  if (result.preferred_date) next.preferred_date = result.preferred_date;
  if (result.preferred_time_range) next.preferred_time_range = result.preferred_time_range;
  if (result.preferred_time_options) next.preferred_time_options = result.preferred_time_options;
  if (result.booking_intent !== undefined) next.booking_intent = result.booking_intent;
  if (result.network_discovery_agreed !== undefined) next.network_discovery_agreed = result.network_discovery_agreed;
  if (result.patient_location) next.patient_location = result.patient_location;
  if (result.selected_clinic && result.selected_clinic.id && result.selected_clinic.slug && result.selected_clinic.name) {
    next.selected_clinic = { id: result.selected_clinic.id, slug: result.selected_clinic.slug, name: result.selected_clinic.name };
  }

  if (result.patient_reported_symptoms) {
    if (next.patient_reported_symptoms) {
      next.patient_reported_symptoms = `${next.patient_reported_symptoms} / ${result.patient_reported_symptoms}`.slice(0, 2000);
    } else {
      next.patient_reported_symptoms = result.patient_reported_symptoms;
    }
  }

  return next;
}
