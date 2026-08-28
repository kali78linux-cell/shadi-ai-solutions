/**
 * Time helpers shared by the schedule API and the schedule UI.
 *
 * ROOT-CAUSE FIX for "Invalid schedule payload": Postgres `time` columns are
 * returned as "09:00:00", while validation accepts strictly "HH:MM". Any
 * load→save round-trip therefore failed with 400. Both sides now normalise
 * through normalizeTimeInput(), and multi-shift days get explicit overlap
 * validation instead of silently-dropped fields.
 */

export type Shift = { start: string; end: string };

/** Accepts HH:MM or HH:MM(:SS)(.fraction); returns canonical "HH:MM" or null. */
export function normalizeTimeInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  if (!match) return null;
  const hh = match[1].padStart(2, '0');
  return `${hh}:${match[2]}`;
}

/** Strict validity check on an already-normalised-or-raw value. */
export function isValidTimeRange(start: string, end: string): boolean {
  const s = normalizeTimeInput(start);
  const e = normalizeTimeInput(end);
  return Boolean(s && e && s < e);
}

/** True when [aStart,aEnd) and [bStart,bEnd) overlap in any way. */
export function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = normalizeTimeInput(aStart);
  const ae = normalizeTimeInput(aEnd);
  const bs = normalizeTimeInput(bStart);
  const be = normalizeTimeInput(bEnd);
  if (!as || !ae || !bs || !be) return false;
  // Treat touching edges (13:00→15:00 after 09:00→13:00) as NON-overlapping.
  return as < be && bs < ae;
}

/** All segments must be valid & mutually non-overlapping. Returns error or null. */
export function validateDayShifts(segments: Array<{ start: string; end: string }>): string | null {
  if (segments.length === 0) return null;
  const normalized: Array<{ start: string; end: string }> = [];
  for (const seg of segments) {
    const start = normalizeTimeInput(seg.start);
    const end = normalizeTimeInput(seg.end);
    if (!start || !end) return 'صيغة وقت غير صالحة';
    if (start >= end) return 'وقت النهاية يجب أن يكون بعد وقت البداية';
    normalized.push({ start, end });
  }
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (timeRangesOverlap(normalized[i].start, normalized[i].end, normalized[j].start, normalized[j].end)) {
        return 'لا يجوز تداخل فترات العمل في اليوم نفسه';
      }
    }
  }
  return null;
}
