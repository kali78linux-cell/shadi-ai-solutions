import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = { __eventId: null as string | null };
      for (const m of ['select', 'is', 'in', 'order', 'limit']) chain[m] = () => chain;
      chain.eq = (k: string, v: unknown) => {
        if (k === 'event_id' && typeof v === 'string') chain.__eventId = v;
        return chain;
      };
      chain.maybeSingle = () =>
        Promise.resolve({
          data: state.rows.find((r) => r.event_id === chain.__eventId) ?? null,
          error: null,
        });
      chain.then = (res: (x: unknown) => void) => res({ data: state.rows[0] ?? null, error: null });
      chain.upsert = (payload: Record<string, unknown>) => {
        state.rows = state.rows.filter((r) => r.event_id !== payload.event_id);
        state.rows.push(payload);
        return Promise.resolve({ data: payload, error: null });
      };
      return chain;
    }),
  },
}));

import { wasStripeEventProcessed, markStripeEventProcessed } from '@/lib/payments/webhookDedup';

describe('stripe webhook idempotency ledger (durable, DB-backed)', () => {
  beforeEach(() => {
    state.rows = [];
  });

  it('unknown event id → not processed', async () => {
    expect(await wasStripeEventProcessed('evt_missing')).toBe(false);
  });

  it('after markStripeEventProcessed, the same event id is reported processed', async () => {
    await markStripeEventProcessed('evt_1', 'checkout.session.completed', 'clinic-1');
    expect(await wasStripeEventProcessed('evt_1')).toBe(true);
  });

  it('different event ids remain independent (out-of-order deliveries stay distinct)', async () => {
    await markStripeEventProcessed('evt_a', 'invoice.paid', null);
    expect(await wasStripeEventProcessed('evt_b')).toBe(false);
    expect(await wasStripeEventProcessed('evt_a')).toBe(true);
  });

  it('re-marking the same event id is a no-op upsert (no duplicates)', async () => {
    await markStripeEventProcessed('evt_x', 'checkout.session.completed', null);
    await markStripeEventProcessed('evt_x', 'checkout.session.completed', null);
    expect(state.rows.filter((r) => r.event_id === 'evt_x').length).toBe(1);
  });

  it('empty event id never claims processed', async () => {
    expect(await wasStripeEventProcessed('')).toBe(false);
    await markStripeEventProcessed('', 'checkout.session.completed', null);
    expect(state.rows.length).toBe(0);
  });
});