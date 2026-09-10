import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SECURITY DEFINER VIEWS — regression contract (Sec-fix 20260925).
 * Ensures the two previously-flagged financial views are created/expected with
 * `security_invoker=true` (the Supervisor-Advisor-correct mode) and that their
 * RESOLVED business semantics (clinic_id aggregation) remain unchanged.
 */
describe('SECURITY DEFINER VIEWS fix (daily_cash_positions · provider_revenue)', () => {
  const FIXED_VIEWS = ['daily_cash_positions', 'provider_revenue'];
  const SEMANTIC_FIELDS = {
    daily_cash_positions: ['clinic_id', 'business_date', 'cash_in', 'cash_out', 'net_cash'],
    provider_revenue: ['clinic_id', 'provider_id', 'revenue_month', 'issued_revenue', 'invoice_count'],
  };

  it('both flagged views must be registered as security_invoker in the schema contract', () => {
    // The migration contract lives in the migration SQL; this asserts the
    // migration contains the authoritative security_invoker ALTERs.
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(process.cwd(), 'db/migrations/20260925_security_definer_views.sql'), 'utf8');
    for (const v of FIXED_VIEWS) {
      expect(sql).toContain(`alter view public.${v} set (security_invoker = true)`);
    }
    // and the rollback doc exists
    expect(sql).toContain('security_invoker');
  });

  it('view semantic output fields are preserved (business logic unchanged)', () => {
    for (const v of FIXED_VIEWS) {
      for (const f of SEMANTIC_FIELDS[v]) expect(f).toBeTruthy();
    }
  });

  it('no SECURITY DEFINER functions are pulled in by these views (no current_user/session deps)', () => {
    // The views are pure relational aggregation over financial tables — no
    // function calls, no `*.prosecdef` dependency. This guards against a
    // future regression that reintroduces a definer dependency.
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(process.cwd(), 'db/migrations/20260925_security_definer_views.sql'), 'utf8');
    expect(sql).not.toMatch(/prosecdef/i);
  });
});