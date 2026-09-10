import { describe, it, expect, vi, beforeEach } from 'vitest';

// Smart-UX closed-day logic (additive — does not change slot generation).
// getDayStatus accepts injectable DB readers (DI) so tests are deterministic
// and never touch the database.

import { getDayStatus } from '@/lib/services/bookingService';

vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const isHoliday = vi.fn();
const loadSchedule = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDayStatus — why a date has no slots', () => {
  it('returns weekday_closed when provider has no enabled schedule that weekday', async () => {
    isHoliday.mockResolvedValue(false);
    loadSchedule.mockResolvedValue({
      days: [
        { weekday: 0, enabled: true },
        { weekday: 1, enabled: true },
        { weekday: 2, enabled: true },
        { weekday: 3, enabled: true },
        { weekday: 4, enabled: true },
        { weekday: 6, enabled: true },
      ],
    });
    // 2026-09-04 is Friday → JS weekday 5 → not enabled → closed
    const st = await getDayStatus('c1', 'p1', '2026-09-04', { isHoliday, loadSchedule });
    expect(st.closed).toBe(true);
    expect(st.reason).toBe('weekday_closed');
    expect(st.weekday).toBe(5);
  });

  it('returns open for a working day (Saturday)', async () => {
    isHoliday.mockResolvedValue(false);
    loadSchedule.mockResolvedValue({ days: [{ weekday: 6, enabled: true }] });
    const st = await getDayStatus('c1', 'p1', '2026-09-05', { isHoliday, loadSchedule });
    expect(st.closed).toBe(false);
    expect(st.reason).toBe('open');
    expect(st.weekday).toBe(6);
  });

  it('returns holiday when clinic is closed that date, before checking the schedule', async () => {
    isHoliday.mockResolvedValue(true);
    const st = await getDayStatus('c1', 'p1', '2026-09-04', { isHoliday, loadSchedule });
    expect(st.closed).toBe(true);
    expect(st.reason).toBe('holiday');
    // schedule should NOT be read once holiday is detected
    expect(loadSchedule).not.toHaveBeenCalled();
  });

  it('falls safe to open when schedule fails to load (so UI falls back to generic empty)', async () => {
    isHoliday.mockResolvedValue(false);
    loadSchedule.mockRejectedValue(new Error('db down'));
    const st = await getDayStatus('c1', 'p1', '2026-09-04', { isHoliday, loadSchedule });
    expect(st.closed).toBe(false);
    expect(st.reason).toBe('open');
  });
});