import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const q: Record<string, any> = {
    from: vi.fn(), select: vi.fn(), insert: vi.fn(), eq: vi.fn(), is: vi.fn(),
    ilike: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(),
  };
  return { q };
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: db.q }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/services/reminderEngine', () => ({ createAppointmentReminders: vi.fn(), cancelAppointmentReminders: vi.fn() }));
vi.mock('@/lib/services/scheduling', () => ({ checkSlotAvailability: vi.fn(), suggestFreeSlots: vi.fn() }));

import { findOrCreatePatient } from '@/lib/services/bookingService';

describe('findOrCreatePatient concurrent insert handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.q.from.mockReturnValue(db.q);
    db.q.select.mockReturnValue(db.q);
    db.q.insert.mockReturnValue(db.q);
    db.q.eq.mockReturnValue(db.q);
    db.q.is.mockReturnValue(db.q);
    db.q.ilike.mockReturnValue(db.q);
    db.q.limit.mockReturnValue(db.q);
  });

  it('returns the tenant-scoped patient created by the competing request after a unique conflict', async () => {
    const existingId = '99999999-9999-9999-9999-999999999999';
    db.q.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: existingId }, error: null });
    db.q.single.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    await expect(findOrCreatePatient({
      clinicId: '11111111-1111-1111-1111-111111111111',
      name: 'Concurrent Test Patient',
      phone: '+970500000000',
    })).resolves.toBe(existingId);
  });
});
