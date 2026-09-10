import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  dateFromIso,
  getWeekDays,
  getWeekStart,
  isSameLocalDay,
  localIsoDate,
  mondayIndex,
} from '@/lib/calendar/weeks';

/**
 * Fixed anchor dates (all verified):
 *   2026-08-31 is a Monday; the following Sunday is 2026-09-06.
 *   2026-12-28 is a Monday; 2027-01-03 is the Sunday closing that week.
 */

describe('calendar week helpers (Monday-first, local-timezone safe)', () => {
  it('localIsoDate pads month/day and never uses UTC conversions', () => {
    expect(localIsoDate(new Date(2026, 7, 31))).toBe('2026-08-31');
    expect(localIsoDate(new Date(2026, 8, 5))).toBe('2026-09-05');
    expect(localIsoDate(new Date(2027, 0, 1))).toBe('2027-01-01');
  });

  it('dateFromIso round-trips local midnight dates', () => {
    const day = dateFromIso('2026-08-31');
    expect(localIsoDate(day)).toBe('2026-08-31');
    expect(day.getFullYear()).toBe(2026);
    expect(day.getHours()).toBe(0);
  });

  it('addDaysIso crosses month and year boundaries', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysIso('2026-09-06', -1)).toBe('2026-09-05');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('mondayIndex maps Monday to 0 and Sunday to 6', () => {
    expect(mondayIndex(new Date(2026, 7, 31))).toBe(0); // Monday
    expect(mondayIndex(new Date(2026, 8, 6))).toBe(6); // Sunday
    expect(mondayIndex(new Date(2026, 8, 4))).toBe(4); // Friday
    expect(mondayIndex(new Date(2026, 8, 1))).toBe(1); // Tuesday
  });

  it('getWeekStart returns Monday for Monday, Sunday and mid-week inputs', () => {
    expect(localIsoDate(getWeekStart(new Date(2026, 7, 31)))).toBe('2026-08-31'); // Monday
    expect(localIsoDate(getWeekStart(new Date(2026, 8, 6)))).toBe('2026-08-31'); // Sunday
    expect(localIsoDate(getWeekStart(new Date(2026, 8, 3)))).toBe('2026-08-31'); // Thursday
  });

  it('getWeekDays(0) returns Monday..Sunday with exact local iso keys', () => {
    const days = getWeekDays(0, new Date(2026, 7, 31));
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.isoDate)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(days.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('getWeekDays(1) shifts to the next week keeping weekday indexes', () => {
    const days = getWeekDays(1, new Date(2026, 7, 31));
    expect(days[0].isoDate).toBe('2026-09-07');
    expect(days[6].isoDate).toBe('2026-09-13');
    expect(days.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('getWeekDays(-1) shifts to the previous week across a month boundary', () => {
    const days = getWeekDays(-1, new Date(2026, 7, 31));
    expect(days[0].isoDate).toBe('2026-08-24');
    expect(days[6].isoDate).toBe('2026-08-30');
  });

  it('getWeekDays crosses year boundaries', () => {
    const days = getWeekDays(0, new Date(2026, 11, 28)); // Mon 2026-12-28
    expect(days[0].isoDate).toBe('2026-12-28');
    expect(days[6].isoDate).toBe('2027-01-03');
    const next = getWeekDays(1, new Date(2026, 11, 28));
    expect(next[0].isoDate).toBe('2027-01-04');
    expect(next[6].isoDate).toBe('2027-01-10');
    const previous = getWeekDays(-1, new Date(2026, 11, 28));
    expect(previous[6].isoDate).toBe('2026-12-27');
  });

  it('isSameLocalDay compares calendar dates independent of time-of-day', () => {
    const lateNight = new Date(2026, 8, 1, 23, 59);
    const midnight = new Date(2026, 8, 1, 0, 0);
    const nextDay = new Date(2026, 8, 2, 1, 0);
    expect(isSameLocalDay(lateNight, midnight)).toBe(true);
    expect(isSameLocalDay(lateNight, nextDay)).toBe(false);
  });
});