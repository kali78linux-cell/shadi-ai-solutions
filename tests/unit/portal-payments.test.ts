import { describe, it, expect, vi, beforeEach } from 'vitest';
import { intentIdToUuid, toMinor, toMajor, currencyExponent } from '@/lib/payments/provider';

/**
 * PP-3 — provider-agnostic primitives + DB-level guarantees (pure logic).
 * Live DB behavior is verified separately via the self-rollback probe.
 */

describe('PP-3 minor/major currency conversion (server-derived amounts)', () => {
  it('uses 2 decimals for ILS/USD and 3 for JOD (fils)', () => {
    expect(currencyExponent('ils')).toBe(2);
    expect(currencyExponent('usd')).toBe(2);
    expect(currencyExponent('jod')).toBe(3);
    expect(currencyExponent('JOD')).toBe(3);
  });

  it('rounds (never truncates) major → minor and back', () => {
    expect(toMinor(70.5, 'ils')).toBe(7050);
    expect(toMinor(70.555, 'ils')).toBe(7056); // rounded up
    expect(toMinor(70.1235, 'jod')).toBe(70124); // 3 decimals: 70.1235 * 1000
    expect(toMajor(7050, 'ils')).toBeCloseTo(70.5, 6);
    expect(toMajor(70124, 'jod')).toBeCloseTo(70.124, 6);
  });

  it('always produces integers for provider amounts', () => {
    for (const amount of [0.01, 12.34, 99.99, 12345.67]) {
      const minor = toMinor(amount, 'usd');
      expect(Number.isInteger(minor)).toBe(true);
      expect(toMajor(minor, 'usd')).toBeCloseTo(amount, 6);
    }
  });
});

describe('PP-3 deterministic idempotency UUID (webhook dedup anchor)', () => {
  it('is a valid UUID and deterministic per intent id', () => {
    const a = intentIdToUuid('pi_3AbcDefGhi123');
    const b = intentIdToUuid('pi_3AbcDefGhi123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs across distinct intent ids (no cross-payment collisions)', () => {
    const ids = ['pi_A1', 'pi_A2', 'pi_B1', 'pi_B2'].map(intentIdToUuid);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('PP-3 DB schema guarantees (migration source-of-truth)', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'db/migrations/20260910_portal_payments.sql'),
    'utf8'
  );

  it('connect accounts: clinic_id unique + stripe_account_id unique', () => {
    expect(sql).toContain('clinic_id          uuid not null unique references public.clinics');
    expect(sql).toContain('stripe_account_id  text not null unique');
  });

  it('payment intents: tenant-safe composite FKs (cross-tenant impossible)', () => {
    expect(sql).toContain('references public.patients (clinic_id, id) on delete cascade');
    expect(sql).toContain('references public.clinic_invoices (clinic_id, id) on delete cascade');
  });

  it('payment intents: lifecycle check includes requires_review (reconciliation)', () => {
    expect(sql).toContain("'requires_review'");
  });

  it('RLS is enabled with NO policies (authenticated → 0 rows, service-role only)', () => {
    expect(sql).toContain('alter table public.clinic_stripe_connect_accounts enable row level security');
    expect(sql).toContain('alter table public.clinic_payment_intents enable row level security');
    expect(sql).not.toMatch(/create policy/i); // deny-all pattern (service role bypasses)
  });

  it('no ledger kinds added and no historical migrations touched by PP-3', () => {
    expect(sql).not.toContain('financial_transactions');
    expect(sql).not.toContain('record_payment');
    expect(sql).not.toContain('drop table');
  });
});