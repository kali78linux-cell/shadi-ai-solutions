import { describe, it, expect } from 'vitest';

/**
 * PP-4 — provider-agnostic refund primitives + DB-level guarantees (pure logic).
 * Live DB behavior is verified separately via a self-rollback probe.
 */

describe('PP-4 refund migration schema guarantees (source-of-truth)', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'db/migrations/20260911_portal_refunds.sql'),
    'utf8'
  );

  it('creates clinic_payment_refunds with tenant-safe composite FKs', () => {
    expect(sql).toContain('clinic_id          uuid not null references public.clinics');
    expect(sql).toContain('references public.patients (clinic_id, id) on delete cascade');
    expect(sql).toContain('references public.clinic_invoices (clinic_id, id) on delete cascade');
    expect(sql).toContain('references public.clinic_payments (clinic_id, id) on delete cascade');
  });

  it('provider_refund_id is unique (idempotency level 2 anchor)', () => {
    expect(sql).toContain('provider_refund_id text not null unique');
  });

  it('supports partial + full refunds with lifecycle statuses', () => {
    // partial/full is data-driven (amount <= refundable); the amount column is
    // positive and linked to ONE original payment.
    expect(sql).toContain('amount             numeric(12,2) not null check (amount > 0)');
    expect(sql).toContain('clinic_payment_id  uuid not null');
    expect(sql).toMatch(/status\s+text not null default 'pending'/);
    for (const s of ['pending', 'processing', 'succeeded', 'failed', 'canceled', 'needs_review']) {
      expect(sql).toContain(`'${s}'`);
    }
  });

  it('has an atomic booking claim (booked_at) for webhook idempotency', () => {
    expect(sql).toContain('booked_at          timestamptz');
  });

  it('has request-level idempotency key (unique per clinic when provided)', () => {
    expect(sql).toContain('idempotency_key    uuid');
    expect(sql).toContain('uq_cpr_idempotency_key');
  });

  it('RLS is enabled with NO policies (authenticated → 0 rows, service-role only)', () => {
    expect(sql).toContain('alter table public.clinic_payment_refunds enable row level security');
    expect(sql).not.toMatch(/create policy/i);
  });

  it('no ledger kinds and no historical migrations touched by PP-4', () => {
    expect(sql).not.toContain('financial_transactions');
    expect(sql).not.toContain('drop table');
  });
});

describe('PP-4 provider interface (createRefund/getRefund present)', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const provider = fs.readFileSync(path.join(process.cwd(), 'lib/payments/provider.ts'), 'utf8');
  const stripeAdapter = fs.readFileSync(path.join(process.cwd(), 'lib/payments/stripeProvider.ts'), 'utf8');

  it('PaymentProvider interface exposes createRefund + getRefund', () => {
    expect(provider).toContain('createRefund(params: CreateRefundParams): Promise<RefundInfo>');
    expect(provider).toContain('getRefund(refundId: string): Promise<RefundInfo>');
  });

  it('portal refund kind is defined', () => {
    expect(provider).toContain("PORTAL_REFUND_KIND = 'portal_refund'");
  });

  it('Stripe adapter implements refunds via /refunds (no card data)', () => {
    expect(stripeAdapter).toContain("'/refunds'");
    expect(stripeAdapter).toContain('payment_intent');
    expect(stripeAdapter).not.toContain('card_number');
    expect(stripeAdapter).not.toContain('card[\'number\']');
  });
});