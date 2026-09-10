import { describe, expect, it } from 'vitest';

// PHASE 1B — pure workflow state-machine tests: every VALID edge, every class
// of INVALID edge (skip/backward), terminal states, unknown states/entities,
// and the clinic-activity "no machine" rule. These definitions are shared by
// the server (enforcement) and the UI (options) — one source of truth.

import {
  allowedTransitionsFor,
  canTransition,
  getWorkflowMachine,
  isTerminalWorkflowState,
  validateWorkflowTransition,
  WORKFLOW_STATE_MACHINES,
} from '@/lib/services/workflowStates';

const IMAGING_EDGES: [string, string][] = [
  ['requested', 'scheduled'],
  ['scheduled', 'in_progress'],
  ['in_progress', 'ready'],
  ['ready', 'delivered'],
  ['requested', 'cancelled'],
  ['scheduled', 'cancelled'],
  ['in_progress', 'cancelled'],
  ['ready', 'cancelled'],
  // Cross-tenant referral lifecycle (20260922)
  ['requested', 'submitted'],
  ['submitted', 'accepted'],
  ['submitted', 'rejected'],
  ['submitted', 'needs_clarification'],
  ['needs_clarification', 'submitted'],
  ['accepted', 'scheduled'],
  ['in_progress', 'completed'],
  ['ready', 'completed'],
];

const LAB_EDGES: [string, string][] = [
  ['received', 'in_production'],
  ['in_production', 'quality_check'],
  ['quality_check', 'ready'],
  ['ready', 'delivered'],
  ['received', 'cancelled'],
  ['in_production', 'cancelled'],
  ['quality_check', 'cancelled'],
  ['ready', 'cancelled'],
];

describe('PHASE 1B — state machines match the closed DHS domain', () => {
  it('imaging machine owns imaging_center with the domain statuses', () => {
    const m = getWorkflowMachine('imaging_requests')!;
    expect(m.activityType).toBe('imaging_center');
    expect(m.initialState).toBe('requested');
    expect(Object.keys(m.transitions).sort()).toEqual(
      [
        'requested', 'scheduled', 'in_progress', 'ready', 'delivered', 'cancelled',
        // cross-tenant referral lifecycle (20260922)
        'submitted', 'accepted', 'rejected', 'needs_clarification', 'completed',
      ].sort()
    );
  });

  it('lab machine owns dental_lab and uses the DB initial state `received` (no invented `accepted`)', () => {
    const m = getWorkflowMachine('lab_cases')!;
    expect(m.activityType).toBe('dental_lab');
    expect(m.initialState).toBe('received');
    expect(Object.keys(m.transitions).sort()).toEqual(
      ['received', 'in_production', 'quality_check', 'ready', 'delivered', 'cancelled'].sort()
    );
    expect('accepted' in m.transitions).toBe(false);
  });

  it('clinic activity has NO invented workflow (extensible registry, fail-closed)', () => {
    expect(getWorkflowMachine('some_future_clinic_flow')).toBeNull();
    expect(getWorkflowMachine(undefined)).toBeNull();
    expect(getWorkflowMachine(null)).toBeNull();
  });
});

describe('PHASE 1B — every VALID transition is allowed', () => {
  it.each(IMAGING_EDGES)('imaging_requests: %s → %s', (from, to) => {
    expect(canTransition('imaging_requests', from, to)).toBe(true);
    expect(validateWorkflowTransition('imaging_requests', from, to)).toBeNull();
    expect(allowedTransitionsFor('imaging_requests', from)).toContain(to);
  });

  it.each(LAB_EDGES)('lab_cases: %s → %s', (from, to) => {
    expect(canTransition('lab_cases', from, to)).toBe(true);
    expect(validateWorkflowTransition('lab_cases', from, to)).toBeNull();
    expect(allowedTransitionsFor('lab_cases', from)).toContain(to);
  });
});

describe('PHASE 1B — every INVALID transition is rejected', () => {
  const INVALID: [string, 'imaging_requests' | 'lab_cases', string, string, string][] = [
    ['skip forward', 'imaging_requests', 'requested', 'in_progress', 'invalid_transition'],
    ['skip forward', 'imaging_requests', 'requested', 'ready', 'invalid_transition'],
    ['skip to terminal', 'imaging_requests', 'scheduled', 'delivered', 'invalid_transition'],
    ['backward', 'imaging_requests', 'in_progress', 'scheduled', 'invalid_transition'],
    ['backward to initial', 'imaging_requests', 'ready', 'requested', 'invalid_transition'],
    ['cancel from terminal', 'imaging_requests', 'delivered', 'cancelled', 'terminal_state'],
    ['restart from cancelled', 'imaging_requests', 'cancelled', 'requested', 'terminal_state'],
    ['advance from delivered', 'imaging_requests', 'delivered', 'ready', 'terminal_state'],
    ['advance from cancelled', 'imaging_requests', 'cancelled', 'in_progress', 'terminal_state'],
    ['skip forward', 'lab_cases', 'received', 'quality_check', 'invalid_transition'],
    ['skip to terminal', 'lab_cases', 'received', 'delivered', 'invalid_transition'],
    ['backward', 'lab_cases', 'ready', 'quality_check', 'invalid_transition'],
    ['restart', 'lab_cases', 'in_production', 'received', 'invalid_transition'],
    ['from delivered', 'lab_cases', 'delivered', 'ready', 'terminal_state'],
    ['from cancelled', 'lab_cases', 'cancelled', 'ready', 'terminal_state'],
  ];

  it.each(INVALID)('%s (%s): %s → %s → %s', (_label, entity, from, to, expected) => {
    expect(canTransition(entity, from, to)).toBe(false);
    expect(validateWorkflowTransition(entity, from, to)).toBe(expected);
  });

  it('unknown states and unknown entity types fail closed', () => {
    expect(validateWorkflowTransition('imaging_requests', 'requested', 'not-a-state')).toBe('unknown_state');
    expect(validateWorkflowTransition('imaging_requests', 'not-a-state', 'scheduled')).toBe('unknown_state');
    expect(validateWorkflowTransition('not-an-entity', 'requested', 'scheduled')).toBe('unknown_entity');
    expect(canTransition('imaging_requests', 'requested', 'accepted')).toBe(false);
    expect(allowedTransitionsFor('imaging_requests', 'bogus')).toEqual([]);
  });

  it('terminal states expose NO further options (UI + server agree)', () => {
    for (const entity of ['imaging_requests', 'lab_cases'] as const) {
      for (const terminal of WORKFLOW_STATE_MACHINES[entity].terminalStates) {
        expect(allowedTransitionsFor(entity, terminal)).toEqual([]);
        expect(isTerminalWorkflowState(entity, terminal)).toBe(true);
      }
    }
  });
});