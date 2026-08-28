import { getAvailableSlots, getActiveServiceById } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';
import { dateInTimeZone, timeInTimeZone, addDaysIso } from '@/lib/ai/understanding';
import type { ClinicOperatingData } from '@/lib/ai/clinicDataContext';

/**
 * REAL AVAILABILITY TOOL (receptionist)
 *
 * The AI is instructed to NEVER invent a date/time. Instead, the orchestrator
 * resolves the earliest real slot using the existing, concurrency-safe booking
 * engine (`getAvailableSlots`), and this concrete slot is injected into the
 * prompt + conversation state. Tool failures return a STRUCTURED failure reason
 * (not "AI unavailable") so the assistant can give a graceful, honest reply.
 *
 * STEP 3 additions (state-driven booking):
 *  - preferred_date / preferred_time_range / preferred_time_options constraints
 *  - clinic IANA timezone for "today" and past-slot filtering (never UTC-blind)
 *  - slotStart/slotEnd come from the availability result + real service duration
 *  - resolveServiceByName / resolveProviderByName (name -> real id; ambiguous -> null)
 */

export type EarliestSlotResult = {
  found: boolean;
  slot?: string;
  slotStart?: string;
  slotEnd?: string;
  date?: string;
  time?: string;
  providerId?: string;
  serviceId?: string;
  reason?: 'service_unavailable' | 'no_slots' | 'error';
  message?: string;
};

export type AvailabilityQuery = {
  clinicId: string;
  providerId: string;
  serviceId: string;
  /** Restrict the search to this exact clinic-local date (YYYY-MM-DD). */
  preferredDate?: string;
  /** Time-of-day constraint (inclusive). */
  preferredTimeRange?: { from?: string; to?: string };
  /** Explicit time preferences like ["13:00","16:00"]. */
  preferredTimeOptions?: string[];
  /** Clinic IANA timezone (e.g. "Asia/Jerusalem") - used for today + past filtering. */
  timeZone?: string;
  /** Injectable clock (tests stay deterministic). */
  now?: Date;
  lookaheadDays?: number;
  limitPerDay?: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Adds minutes to an "HH:MM" string -> "HH:MM" (mod 24h). */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** Normalises a name for matching (strip honorifics, desire words, collapse whitespace, lowercase). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/د\.|الدكتور|الدكتورة|دكتور|دكتورة|طبيب|أخصائي|اخصائي|مقدم|مقدمة|خدمة|بدي|أريد|اريد|ابدي|احجز|أحجز|حجز|موعد|عندكم/gi, '')
    .replace(/[.,،]|ال/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a requested service NAME against the clinic's real operating data.
 * Returns null when there is no match OR the match is ambiguous (multiple
 * candidates) - the assistant must ask for clarification instead of guessing.
 */
export function resolveServiceByName(name: string, data: ClinicOperatingData): { id: string; name: string } | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const matches = data.services.filter((s) => {
    const sn = normalizeName(s.name);
    return sn === normalized || sn.includes(normalized) || normalized.includes(sn);
  });
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name } : null;
}

/**
 * Resolves a provider NAME against the clinic's real operating data.
 * Returns null when there is no match OR the match is ambiguous.
 */
export function resolveProviderByName(name: string, data: ClinicOperatingData): { id: string; name: string } | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const matches = data.providers.filter((p) => {
    const pn = normalizeName(p.name);
    return pn === normalized || pn.includes(normalized) || normalized.includes(pn);
  });
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name } : null;
}

/**
 * Finds the earliest available slot matching the given constraints by scanning
 * REAL availability across a lookahead window. Reuses the existing scheduling
 * engine so it respects provider schedules, holidays, vacations, working hours,
 * breaks, and existing appointments automatically.
 *
 * Past slots are excluded using the clinic's IANA timezone (never UTC-blind).
 */
export async function findEarliestAvailableSlot(params: AvailabilityQuery): Promise<EarliestSlotResult> {
  const {
    clinicId,
    providerId,
    serviceId,
    preferredDate,
    preferredTimeRange,
    preferredTimeOptions,
    timeZone = 'UTC',
    now = new Date(),
    lookaheadDays = 14,
    limitPerDay = 5,
  } = params;

  const service = await getActiveServiceById(clinicId, serviceId).catch(() => null);
  if (!service) {
    return { found: false, reason: 'service_unavailable', message: 'service not available for this clinic' };
  }

  // Days to scan: the requested date only, or a lookahead from clinic-local today.
  const todayLocal = dateInTimeZone(now, timeZone);
  const nowTimeLocal = timeInTimeZone(now, timeZone);
  const days: string[] = preferredDate
    ? [preferredDate]
    : Array.from({ length: lookaheadDays }, (_, i) => addDaysIso(todayLocal, i));

  for (const day of days) {
    try {
      const slots = await getAvailableSlots(clinicId, providerId, day, limitPerDay, serviceId);
      if (!slots || slots.length === 0) continue;

      for (const slot of slots) {
        const m = slot.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (!m) continue;
        const slotDate = m[1];
        const slotTime = m[2];

        // Past-slot guard (clinic-local wall clock, matching how the engine encodes slots).
        if (slotDate < todayLocal) continue;
        if (slotDate === todayLocal && slotTime <= nowTimeLocal) continue;

        // preferred_time_range constraint (inclusive).
        if (preferredTimeRange) {
          const from = preferredTimeRange.from ?? '00:00';
          const to = preferredTimeRange.to ?? '23:59';
          if (slotTime < from || slotTime > to) continue;
        }
        // preferred_time_options constraint.
        if (preferredTimeOptions && preferredTimeOptions.length > 0) {
          if (!preferredTimeOptions.includes(slotTime)) continue;
        }

        const endTime = addMinutesToTime(slotTime, service.duration_minutes);
        return {
          found: true,
          slot,
          slotStart: slot,
          slotEnd: `${slotDate}T${endTime}:00.000Z`,
          date: slotDate,
          time: slotTime,
          providerId,
          serviceId,
        };
      }
    } catch (err) {
      // A single day failing (e.g. malformed schedule) must not abort the scan.
      logEvent('availability_tool_date_error', {
        clinic_id: clinicId,
        provider_id: providerId,
        service_id: serviceId,
        date: day,
        error: err instanceof Error ? err.message : String(err),
      }, 'warn');
      if (String(err?.message ?? err).includes('Provider is not assigned to this service')) {
        return { found: false, reason: 'error', message: 'provider not assigned to service' };
      }
    }
  }

  return { found: false, reason: 'no_slots', message: 'no real slot found matching constraints' };
}
