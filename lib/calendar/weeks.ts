/**
 * STEP 14E — Calendar helpers for the appointments week/day view.
 *
 * Pure, dependency-free, testable date utilities that operate on "calendar"
 * dates (YYYY-MM-DD) in the BROWSER'S LOCAL timezone.
 *
 * The appointments page previously derived day keys with
 * `date.toISOString().slice(0, 10)` (UTC). For clinics ahead of UTC (e.g.
 * Asia/Jerusalem, the project's live clinic) that produced a WRONG date key
 * between local 00:00–03:00, silently shifting the whole week by one day.
 * Every function here avoids UTC conversions entirely: dates are built with
 * the local Date constructor, so week arithmetic and keys stay aligned with
 * what the user actually sees on the calendar.
 *
 * Week convention: Monday-first (index 0 = Monday … 6 = Sunday), matching the
 * existing dashboard UI (dayNames order + dayAccents palette).
 */

export type WeekDay = {
  /** Local calendar date, YYYY-MM-DD. */
  isoDate: string;
  /** Date object at local midnight. */
  date: Date;
  /** 0 = Monday … 6 = Sunday. */
  dayIndex: number;
};

/** Local calendar date (YYYY-MM-DD) of an instant — no UTC conversion. */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local midnight Date for a YYYY-MM-DD key. */
export function dateFromIso(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Adds whole days to a YYYY-MM-DD key (calendar-safe, crosses month/year). */
export function addDaysIso(isoDate: string, days: number): string {
  const date = dateFromIso(isoDate);
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

/** Monday-first weekday index: Monday = 0 … Sunday = 6. */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Local midnight of the Monday that starts the week containing `date`. */
export function getWeekStart(date: Date = new Date()): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - mondayIndex(start));
  return start;
}

/**
 * The 7 displayed days (Monday-first) for the week at `weekOffset`
 * (0 = the week containing `today`, 1 = next week, -1 = previous week).
 */
export function getWeekDays(weekOffset: number, today: Date = new Date()): WeekDay[] {
  const weekStart = getWeekStart(today);
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index);
    return { isoDate: localIsoDate(date), date, dayIndex: index };
  });
}

/** Same LOCAL calendar day regardless of time-of-day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}