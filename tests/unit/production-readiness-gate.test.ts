import { describe, it, expect } from 'vitest';
// PHASE 8 — Production Readiness Gate core (pure logic; no side effects).
import {
  CODE_GATE_IDS,
  EXTERNAL_GATE_IDS,
  evaluateCodeGates,
  evaluateExternalGates,
  evaluateOverall,
  makeStep,
  stepFromExit,
} from '../../scripts/lib/readiness-core.mjs';

const allPass = [
  { id: 'typescript', status: 'pass', evidence: '' },
  { id: 'tests', status: 'pass', evidence: '' },
  { id: 'build', status: 'pass', evidence: '' },
  { id: 'migrations_order', status: 'pass', evidence: '' },
  { id: 'database_rls', status: 'pass', evidence: '' },
  { id: 'targeted_security', status: 'pass', evidence: '' },
];

describe('PHASE 8 — readiness core: code gates', () => {
  it('PASS when every required code gate passes', () => {
    expect(evaluateCodeGates(allPass).verdict).toBe('PASS');
  });

  it('FAIL when any code gate fails', () => {
    const steps = allPass.map((s) => (s.id === 'build' ? { ...s, status: 'fail' } : s));
    const out = evaluateCodeGates(steps);
    expect(out.verdict).toBe('FAIL');
    expect(out.reason).toContain('build');
  });

  it('BLOCKED when a required gate is missing', () => {
    const steps = allPass.filter((s) => s.id !== 'tests');
    expect(evaluateCodeGates(steps).verdict).toBe('BLOCKED');
  });

  it('BLOCKED when a required gate is blocked', () => {
    const steps = allPass.map((s) => (s.id === 'database_rls' ? { ...s, status: 'blocked' } : s));
    expect(evaluateCodeGates(steps).verdict).toBe('BLOCKED');
  });

  it('makeStep rejects invalid status', () => {
    expect(() => makeStep('x', 'maybe')).toThrow();
  });

  it('stepFromExit maps exit codes', () => {
    expect(stepFromExit('typescript', 0).status).toBe('pass');
    expect(stepFromExit('build', 1).status).toBe('fail');
  });
});

describe('PHASE 8 — readiness core: external gates', () => {
  it('every external gate is treated OPEN by default (never PASS by default)', () => {
    const out = evaluateExternalGates({});
    expect(out.openCount).toBe(EXTERNAL_GATE_IDS.length);
    expect(out.verdict).toBe('OPEN');
  });

  it('a gate opens only when status === "closed"', () => {
    const gates = {};
    for (const id of EXTERNAL_GATE_IDS) gates[id] = { status: 'closed' };
    const out = evaluateExternalGates(gates);
    expect(out.closedCount).toBe(EXTERNAL_GATE_IDS.length);
    expect(out.verdict).toBe('CLOSED');
  });

  it('a single open gate keeps the overall verdict "EXTERNAL GATES OPEN"', () => {
    const gates = Object.fromEntries(EXTERNAL_GATE_IDS.map((id, i) => [id, { status: i === 0 ? 'open' : 'closed' }]));
    expect(evaluateExternalGates(gates).openCount).toBe(1);
  });
});

describe('PHASE 8 — readiness core: overall verdict', () => {
  it('code PASS + external OPEN → "PASS — IMPLEMENTATION COMPLETE / EXTERNAL GATES OPEN"', () => {
    const out = evaluateOverall(allPass, {});
    expect(out.overall).toBe('PASS — IMPLEMENTATION COMPLETE / EXTERNAL GATES OPEN');
  });

  it('code FAIL + any external → overall FAIL (never masked by open gates)', () => {
    const steps = allPass.map((s) => (s.id === 'tests' ? { ...s, status: 'fail' } : s));
    expect(evaluateOverall(steps, {}).overall).toBe('FAIL');
  });

  it('code BLOCKED → overall BLOCKED', () => {
    const steps = allPass.map((s) => (s.id === 'database_rls' ? { ...s, status: 'blocked' } : s));
    expect(evaluateOverall(steps, {}).overall).toBe('BLOCKED');
  });

  it('code PASS + external CLOSED → "PASS — IMPLEMENTATION COMPLETE / ALL GATES CLOSED"', () => {
    const gates = Object.fromEntries(EXTERNAL_GATE_IDS.map((id) => [id, { status: 'closed' }]));
    expect(evaluateOverall(allPass, gates).overall).toBe('PASS — IMPLEMENTATION COMPLETE / ALL GATES CLOSED');
  });

  it('gate id lists match the gate script contract', () => {
    expect(CODE_GATE_IDS).toHaveLength(6);
    expect(EXTERNAL_GATE_IDS).toHaveLength(7);
    expect(EXTERNAL_GATE_IDS).toContain('owner_approval_first_real_patient');
    expect(EXTERNAL_GATE_IDS).toContain('restore_drill');
  });
});