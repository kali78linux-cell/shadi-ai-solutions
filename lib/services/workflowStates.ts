/**
 * PHASE 1B — Workflow-Directed Transitions — State Machine Definitions (pure).
 *
 * CLIENT-SAFE: no server imports. Both the server service
 * (lib/services/workflowService.ts) and the UI (ActivityOperations) import
 * THIS module, so the UI can only ever offer transitions the server will
 * accept. The server remains the single enforcement point (UI is never trusted).
 *
 * Sources of truth for the states (closed DHS domain, migration 20260914
 * check constraints — NOT invented here):
 *   imaging_requests: requested | scheduled | in_progress | ready | delivered | cancelled
 *   lab_cases:        received | in_production | quality_check | ready | delivered | cancelled
 *
 * NOTE (documented deviation): the lab lifecycle's authoritative initial state
 * in the closed schema is `received` (DB default + check constraint). A literal
 * "accepted" state does not exist in the domain and was NOT invented. If the
 * owner later approves it, it is one registry entry + one additive migration.
 *
 * Semantics:
 *   - forward production chain per activity
 *   - `cancelled` is reachable from every non-terminal state (the DB check
 *     constraint allows it there); `delivered` and `cancelled` are TERMINAL
 *   - clinic activity has NO workflow machine yet (no documented lifecycle —
 *     none was invented). The registry is extensible; a `clinic` machine can
 *     be added later without touching enforcement code.
 */

export const WORKFLOW_ENTITY_TYPES = ['imaging_requests', 'lab_cases'] as const;
export type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

export type WorkflowActivityType = 'imaging_center' | 'dental_lab';

export type WorkflowState = string;

export type WorkflowMachine = {
  entityType: WorkflowEntityType;
  /** The activity type that owns this workflow (clinic tenants can never run it). */
  activityType: WorkflowActivityType;
  table: WorkflowEntityType;
  initialState: WorkflowState;
  terminalStates: readonly WorkflowState[];
  /** from → allowed destinations. Absence of a state = non-existent state. */
  transitions: Record<WorkflowState, readonly WorkflowState[]>;
};

export const WORKFLOW_STATE_MACHINES: Record<WorkflowEntityType, WorkflowMachine> = {
  imaging_requests: {
    entityType: 'imaging_requests',
    activityType: 'imaging_center',
    table: 'imaging_requests',
    initialState: 'requested',
    terminalStates: ['delivered', 'cancelled', 'completed', 'rejected'],
    transitions: {
      requested: ['scheduled', 'cancelled', 'submitted'],
      // Cross-tenant referral lifecycle (20260922): a referring clinic submits
      // the request; the imaging center accepts/rejects/asks for clarification.
      submitted: ['accepted', 'rejected', 'needs_clarification', 'cancelled'],
      accepted: ['scheduled', 'cancelled'],
      rejected: [],
      needs_clarification: ['submitted', 'cancelled'],
      scheduled: ['in_progress', 'cancelled'],
      in_progress: ['ready', 'completed', 'cancelled'],
      ready: ['delivered', 'completed', 'cancelled'],
      completed: [],
      delivered: [],
      cancelled: [],
    },
  },
  lab_cases: {
    entityType: 'lab_cases',
    activityType: 'dental_lab',
    table: 'lab_cases',
    initialState: 'received',
    terminalStates: ['delivered', 'cancelled'],
    transitions: {
      received: ['in_production', 'cancelled'],
      in_production: ['quality_check', 'cancelled'],
      quality_check: ['ready', 'cancelled'],
      ready: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    },
  },
};

export function isWorkflowEntityType(value: unknown): value is WorkflowEntityType {
  return typeof value === 'string' && (WORKFLOW_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Machine for an entity type, or null when none exists (e.g. clinic activity). */
export function getWorkflowMachine(entityType: unknown): WorkflowMachine | null {
  return isWorkflowEntityType(entityType) ? WORKFLOW_STATE_MACHINES[entityType] : null;
}

export function isWorkflowState(entityType: WorkflowEntityType, state: unknown): boolean {
  return typeof state === 'string' && state in WORKFLOW_STATE_MACHINES[entityType].transitions;
}

export function isTerminalWorkflowState(entityType: WorkflowEntityType, state: unknown): boolean {
  return (
    typeof state === 'string' && WORKFLOW_STATE_MACHINES[entityType].terminalStates.includes(state)
  );
}

/** Allowed destination states from `from` (empty for terminal/unknown states). */
export function allowedTransitionsFor(entityType: WorkflowEntityType, from: unknown): WorkflowState[] {
  if (!isWorkflowState(entityType, from)) return [];
  return [...WORKFLOW_STATE_MACHINES[entityType].transitions[from as WorkflowState]];
}

/** Pure transition check — the single source of truth shared by server and UI. */
export function canTransition(entityType: WorkflowEntityType, from: unknown, to: unknown): boolean {
  if (!isWorkflowState(entityType, from) || !isWorkflowState(entityType, to)) return false;
  return WORKFLOW_STATE_MACHINES[entityType].transitions[from as WorkflowState].includes(to as WorkflowState);
}

export type WorkflowValidationFailure =
  | 'unknown_entity'
  | 'unknown_state'
  | 'terminal_state'
  | 'invalid_transition';

/** Validates a transition purely; returns the failure reason or null when valid. */
export function validateWorkflowTransition(
  entityType: unknown,
  from: unknown,
  to: unknown
): WorkflowValidationFailure | null {
  if (!isWorkflowEntityType(entityType)) return 'unknown_entity';
  if (!isWorkflowState(entityType, to)) return 'unknown_state';
  if (!isWorkflowState(entityType, from)) return 'unknown_state';
  if (isTerminalWorkflowState(entityType, from)) return 'terminal_state';
  if (!canTransition(entityType, from, to)) return 'invalid_transition';
  return null;
}