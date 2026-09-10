/**
 * PHASE 8 — Production Readiness Gate — pure aggregation core.
 *
 * Shared by scripts/production-readiness-gate.mjs (the runnable gate) and
 * tests/unit/production-readiness-gate.test.ts. NO side effects, NO imports —
 * pure functions so the gate decision is testable without running builds.
 *
 * Semantics (aligned with PRE_PRODUCTION_CHECKLIST.md: "BLOCKED ≠ PASS" and
 * the documented GO gate: "لا GO حتى Backups/PITR + Restore Drill ناجح"):
 *   - Code gates (tsc/tests/build/db/migrations/targeted) → PASS | FAIL
 *   - External gates (owner actions) → OPEN | CLOSED (never PASS by default)
 *   - overall:
 *       FAIL                              → any code gate failed
 *       PASS — IMPLEMENTATION COMPLETE    → all code gates passed
 *       BLOCKED                           → a required step could not run
 */

export const CODE_GATE_IDS = [
  'typescript',
  'tests',
  'build',
  'migrations_order',
  'database_rls',
  'targeted_security',
];

export const EXTERNAL_GATE_IDS = [
  'supabase_backups_pitr',
  'staging_project',
  'restore_drill',
  'stripe_production_secrets',
  'stripe_connect_kyc',
  'country_gate_ps_jo_sa_kw',
  'owner_approval_first_real_patient',
];

export const EXTERNAL_GATE_LABELS = {
  supabase_backups_pitr: 'Supabase Backups/PITR (Dashboard, Pro plan for PITR)',
  staging_project: 'Staging project (Supabase second project + Vercel preview env, TEST keys only)',
  restore_drill: 'Restore Drill executed on staging (backup → restore → verify)',
  stripe_production_secrets: 'Stripe production secrets (live keys, restricted API key)',
  stripe_connect_kyc: 'Stripe Connect / KYC for platform payouts',
  country_gate_ps_jo_sa_kw: 'Country gate: PS / JO / SA / KW',
  owner_approval_first_real_patient: 'Owner approval for FIRST REAL CLINIC / FIRST REAL PATIENT',
};

/** Normalizes one step result. status: pass | fail | blocked */
export function makeStep(id, status, evidence = '') {
  const allowed = ['pass', 'fail', 'blocked'];
  if (!allowed.includes(status)) {
    throw new Error(`invalid step status "${status}" for "${id}"`);
  }
  return { id, status, evidence: String(evidence ?? '') };
}

/**
 * Aggregates code-gate step results into the code-gate verdict.
 *   any fail            → FAIL
 *   any blocked         → BLOCKED (cannot prove readiness)
 *   otherwise           → PASS
 */
export function evaluateCodeGates(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const ids = list.map((s) => s.id);
  const missing = CODE_GATE_IDS.filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    return { verdict: 'BLOCKED', reason: `missing required gates: ${missing.join(', ')}` };
  }
  const failed = list.filter((s) => s.status === 'fail');
  if (failed.length > 0) {
    return { verdict: 'FAIL', reason: `failed gates: ${failed.map((s) => s.id).join(', ')}` };
  }
  const blocked = list.filter((s) => s.status === 'blocked');
  if (blocked.length > 0) {
    return { verdict: 'BLOCKED', reason: `blocked gates: ${blocked.map((s) => s.id).join(', ')}` };
  }
  return { verdict: 'PASS', reason: 'all code gates passed' };
}

/**
 * External gates: default status for every gate is 'open' (an Owner must
 * explicitly close them). Anything not 'closed' keeps the gate OPEN — the
 * checklist file can NEVER fake a PASS.
 */
export function evaluateExternalGates(gates = {}) {
  const statuses = {};
  for (const id of EXTERNAL_GATE_IDS) {
    const raw = gates?.[id]?.status ?? 'open';
    statuses[id] = raw === 'closed' ? 'closed' : 'open';
  }
  const openCount = Object.values(statuses).filter((s) => s === 'open').length;
  return {
    statuses,
    openCount,
    closedCount: EXTERNAL_GATE_IDS.length - openCount,
    verdict: openCount === 0 ? 'CLOSED' : 'OPEN',
  };
}

/**
 * Final verdict per the documented semantics:
 *   code FAIL  → { overall: 'FAIL' }
 *   code BLOCKED → { overall: 'BLOCKED' }
 *   code PASS + external OPEN → PASS — IMPLEMENTATION COMPLETE / EXTERNAL GATES OPEN
 *   code PASS + external CLOSED → PASS — IMPLEMENTATION COMPLETE (all gates closed;
 *       First Real Patient still requires explicit Owner approval per MASTER PLAN §12)
 */
export function evaluateOverall(codeGates, externalGates) {
  const code = evaluateCodeGates(codeGates);
  const external = evaluateExternalGates(externalGates);
  if (code.verdict === 'FAIL') {
    return { code: code.verdict, external: external.verdict, overall: 'FAIL', reason: code.reason };
  }
  if (code.verdict === 'BLOCKED') {
    return { code: code.verdict, external: external.verdict, overall: 'BLOCKED', reason: code.reason };
  }
  if (external.verdict === 'OPEN') {
    return {
      code: code.verdict,
      external: external.verdict,
      overall: 'PASS — IMPLEMENTATION COMPLETE / EXTERNAL GATES OPEN',
      reason: `${external.openCount} external gate(s) still open`,
    };
  }
  return {
    code: code.verdict,
    external: external.verdict,
    overall: 'PASS — IMPLEMENTATION COMPLETE / ALL GATES CLOSED',
    reason: 'all external gates closed; FIRST REAL PATIENT still requires explicit Owner approval',
  };
}

/** Extracts a pass/fail from common tool outputs (exit code + text). */
export function stepFromExit(id, exitCode, evidence = '') {
  return makeStep(id, exitCode === 0 ? 'pass' : 'fail', evidence);
}