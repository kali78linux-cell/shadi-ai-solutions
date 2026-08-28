import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));

/**
 * Infinite-chain thenable builder. Any call chain resolves on await with rows
 * for that table; assign via state.rows[table] (set {__count:[n]} for counts).
 */
function chainFrom(state: { rows: Record<string, unknown[]> }) {
  return (_table: string) => {
    const table = _table;
    const payload = () => {
      if (Array.isArray(state.rows[`__count:${table}`])) {
        return { data: null, error: null, count: state.rows[`__count:${table}`]![0] as number };
      }
      return { data: state.rows[table] ?? [], error: null, count: null };
    };
    const proxy: any = new Proxy(function () {}, {
      get(_t, key) {
        if (key === 'then') return (res: (v: unknown) => void) => res(payload());
        return (..._a: unknown[]) => proxy;
      },
      apply() { return proxy; },
    });
    return proxy;
  };
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: chainFrom(state) } }));

import { findNearbyClinics, haversineKm } from '@/lib/services/clinicDirectory';

describe('haversineKm', () => {
  it('computes plausible Ramallah↔Nablus distance (~40km)', () => {
    const d = haversineKm(31.9, 35.2, 32.22, 35.25);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(60);
  });
  it('is zero for identical points', () => {
    expect(haversineKm(31.5, 35.1, 31.5, 35.1)).toBeCloseTo(0, 5);
  });
});

describe('findNearbyClinics public-safe projection & honesty', () => {
  beforeEach(() => { state.rows = {}; });

  it('returns only public-safe fields and sorts by distance', async () => {
    state.rows.clinics = [
      { id: 'c2', slug: 'far', name: 'عيادة بعيدة', city: 'نابلس', area: null, address: 'شارع 9', latitude: 32.3, longitude: 35.3, phone: '+970SECRET', settings: { secret: true } },
      { id: 'c1', slug: 'near', name: 'عيادة قريبة', city: 'رام الله', area: 'وسط', address: 'شارع 1', latitude: 32.21, longitude: 35.2, phone: '+970SECRET2', settings: {} },
    ];
    const result = await findNearbyClinics({ location: { latitude: 32.2, longitude: 35.19 }, radiusKm: 100 });
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('c1'); // nearest first
    expect(JSON.stringify(result)).not.toContain('+970SECRET');
    expect((result as any)[0].settings).toBeUndefined();
  });

  it('is honest when nothing exists — empty list, never fabricated clinics', async () => {
    const result = await findNearbyClinics({ location: { latitude: 32.2, longitude: 35.2 } });
    expect(result).toEqual([]);
  });
});
