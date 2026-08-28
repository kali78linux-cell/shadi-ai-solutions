import { describe, expect, it } from 'vitest';
import { normalizeTimeInput, isValidTimeRange, timeRangesOverlap, validateDayShifts } from '@/lib/server/scheduleTime';

describe('normalizeTimeInput', () => {
  it('normalises DB time values (HH:MM:SS) to HH:MM', () => {
    expect(normalizeTimeInput('09:00:00')).toBe('09:00');
    expect(normalizeTimeInput('17:30:45')).toBe('17:30');
  });
  it('accepts already-canonical values and single digit hours', () => {
    expect(normalizeTimeInput('9:05')).toBe('09:05');
    expect(normalizeTimeInput('21:15')).toBe('21:15');
  });
  it('rejects invalid formats', () => {
    expect(normalizeTimeInput('24:00')).toBeNull();
    expect(normalizeTimeInput('12:60')).toBeNull();
    expect(normalizeTimeInput('abc')).toBeNull();
    expect(normalizeTimeInput(90)).toBeNull();
  });
});

describe('range validation', () => {
  it('requires end after start', () => {
    expect(isValidTimeRange('09:00', '13:00')).toBe(true);
    expect(isValidTimeRange('09:00', '09:00')).toBe(false);
    expect(isValidTimeRange('15:00', '13:00')).toBe(false);
  });
});

describe('overlap detection', () => {
  it('flags overlapping shifts', () => {
    expect(timeRangesOverlap('09:00', '14:00', '13:00', '18:00')).toBe(true);
    expect(timeRangesOverlap('09:00', '13:00', '11:00', '12:00')).toBe(true);
  });
  it('allows touching edges and disjoint shifts', () => {
    expect(timeRangesOverlap('09:00', '13:00', '13:00', '20:00')).toBe(false);
    expect(timeRangesOverlap('09:00', '10:00', '11:00', '12:00')).toBe(false);
  });
});

describe('validateDayShifts (multi-shift workdays)', () => {
  it('accepts morning + evening shifts example', () => {
    expect(validateDayShifts([{ start: '09:00', end: '13:00' }, { start: '15:00', end: '20:00' }])).toBeNull();
  });
  it('rejects overlapping segments with Arabic error', () => {
    expect(validateDayShifts([{ start: '09:00', end: '16:00' }, { start: '15:00', end: '20:00' }])).toMatch(/تداخل/);
  });
  it('rejects inverted segment', () => {
    expect(validateDayShifts([{ start: '17:00', end: '08:00' }])).toMatch(/بعد وقت البداية/);
  });
  it('empty day is valid', () => {
    expect(validateDayShifts([])).toBeNull();
  });
});
