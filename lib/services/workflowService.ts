/**
 * PHASE 1B — Workflow-Directed Transitions — Server Service (server-only).
 *
 * Enforcement pipeline for EVERY status transition (fail-closed end to end):
 *   1. machine lookup            — unknown entity type → deny (clinic has no machine yet)
 *   2. validate requested state  — must be a real state of the machine
 *   3. validate ACTIVITY         — the clinic's activity_type must own the workflow
 *                                  (a clinic tenant can never run imaging/lab workflows)
 *   4. load CURRENT state        — tenant-scoped (clinic_id) read of the row
 *   5. validate TRANSITION       — pure machine check (terminal / invalid / unknown)
 *   6. apply update + AUDIT      — ONE atomic rpc (migration 20260917):
 *                                  guarded optimistic update (status = from) so
 *                                  concurrent/conflicting transitions serialize,
 *                                  then the immutable workflow_audit insert in the
 *                                  SAME transaction — a transition is never applied
 *                                  without its audit row (fail-closed).
 *
 * RBAC runs BEFORE this service in the API layer (authorize → roleDenied → here);
 * the service never derives a clinic from untrusted input.
 *
 * Never import from a client component (imports supabaseAdmin).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import {
  allowedTransitionsFor,
  getWorkflowMachine,
  isWorkflowEntityType,
  validateWorkflowTransition,
  WORKFLOW_STATE_MACHINES,
  type WorkflowEntityType,
  type WorkflowState,
} from './workflowStates';

export { allowedTransitionsFor, getWorkflowMachine, isWorkflowEntityType, validateWorkflowTransition, WORKFLOW_STATE_MACHINES };
export type { WorkflowEntityType, WorkflowState };

export type WorkflowDenialReason =
  | 'unknown_entity' // entity type has no workflow machine (fail-closed; clinic lifecycle TBD)
  | 'unknown_state' // requested/current state does not exist in the machine
  | 'terminal_state' // current state is terminal (delivered/cancelled)
  | 'invalid_transition' // edge not in the machine (skip/backward)
  | 'wrong_activity' // the clinic's activity_type does not own this workflow
  | 'clinic_unresolvable' // clinic row missing/unreadable (fail-closed)
  | 'entity_not_found' // tenant-scoped row does not exist (or belongs to another tenant)
  | 'transition_conflict' // concurrent transition won the guarded update (409)
  | 'infra_error'; // rpc/db failure — no transition is applied without audit (fail-closed)

export class WorkflowTransitionError extends Error {
  readonly reason: WorkflowDenialReason;
  readonly entityType: WorkflowEntityType | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;

  constructor(
    reason: WorkflowDenialReason,
    entityType: WorkflowEntityType | null = null,
    fromStatus: string | null = null,
    toStatus: string | null = null
  ) {
    super(`Workflow transition denied (${reason}) for "${entityType ?? '?'}" ${fromStatus ?? '?'} → ${toStatus ?? '?'}`);
    this.name = 'WorkflowTransitionError';
    this.reason = reason;
    this.entityType = entityType;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

/** Maps a WorkflowTransitionError to an HTTP response; null for other errors. */
export function workflowErrorResponse(err: unknown): Response | null {
  if (!(err instanceof WorkflowTransitionError)) return null;
  const status =
    err.reason === 'entity_not_found' ? 404 : err.reason === 'transition_conflict' ? 409 : 400;
  return new Response(
    JSON.stringify({
      error: 'WORKFLOW_TRANSITION_INVALID',
      reason: err.reason,
      entity_type: err.entityType,
      from_status: err.fromStatus,
      to_status: err.toStatus,
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

type ClinicActivityRow = { activity_type?: unknown } | null;

async function loadClinicActivityType(clinicId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select('activity_type')
    .eq('id', clinicId)
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowTransitionError('clinic_unresolvable');
  const raw = (data as ClinicActivityRow)?.activity_type;
  return typeof raw === 'string' ? raw : null;
}

async function loadEntityStatus(
  table: WorkflowEntityType,
  clinicId: string,
  entityId: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('status')
    .eq('id', entityId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowTransitionError('infra_error', table, null, null);
  if (!data) throw new WorkflowTransitionError('entity_not_found', table, null, null);
  return String((data as { status: unknown }).status);
}

type RpcResult = { ok?: boolean; reason?: string; status?: string };

async function callTransitionRpc(opts: {
  clinicId: string;
  entityType: WorkflowEntityType;
  entityId: string;
  fromStatus: string;
  toStatus: string;
  actorUserId: string | null;
  actorRole: string | null;
  reason: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabaseAdmin.rpc('apply_workflow_transition', {
    p_clinic_id: opts.clinicId,
    p_entity_type: opts.entityType,
    p_entity_id: opts.entityId,
    p_from_status: opts.fromStatus,
    p_to_status: opts.toStatus,
    p_actor_clinic_user_id: opts.actorUserId,
    p_actor_role: opts.actorRole,
    p_reason: opts.reason,
  });
  if (error) throw new WorkflowTransitionError('infra_error', opts.entityType, opts.fromStatus, opts.toStatus);
  return (data ?? {}) as RpcResult;
}


export type WorkflowTransitionInput = {
  clinicId: string;
  entityType: WorkflowEntityType;
  entityId: string;
  toStatus: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
};

export type WorkflowTransitionResult = {
  ok: true;
  entityType: WorkflowEntityType;
  entityId: string;
  fromStatus: string;
  toStatus: string;
};

/**
 * Executes one workflow transition through the full fail-closed pipeline.
 * Throws WorkflowTransitionError on ANY denial — never a silent no-op.
 */
export async function applyWorkflowTransition(input: WorkflowTransitionInput): Promise<WorkflowTransitionResult> {
  const { clinicId, entityId, toStatus } = input;

  // 1) machine lookup (unknown entity types — including any future clinic
  //    lifecycle that is not yet defined — are denied, never guessed).
  const machine = getWorkflowMachine(input.entityType);
  if (!machine || !isWorkflowEntityType(input.entityType)) {
    throw new WorkflowTransitionError('unknown_entity', null, null, toStatus);
  }
  const entityType = input.entityType;

  // 2) requested destination must be a real state.
  if (!machine.transitions[toStatus]) {
    throw new WorkflowTransitionError('unknown_state', entityType, null, toStatus);
  }

  // 3) activity ownership (fail-closed: unreadable clinic denies too).
  const activityType = await loadClinicActivityType(clinicId);
  if (!activityType) throw new WorkflowTransitionError('clinic_unresolvable', entityType, null, toStatus);
  if (activityType !== machine.activityType) {
    throw new WorkflowTransitionError('wrong_activity', entityType, null, toStatus);
  }

  // 4) current state — tenant-scoped read.
  const fromStatus = await loadEntityStatus(entityType, clinicId, entityId);

  // 5) pure machine validation.
  const failure = validateWorkflowTransition(entityType, fromStatus, toStatus);
  if (failure) throw new WorkflowTransitionError(failure, entityType, fromStatus, toStatus);

  // 6) atomic guarded update + audit (single rpc transaction).
  const result = await callTransitionRpc({
    clinicId,
    entityType,
    entityId,
    fromStatus,
    toStatus,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    reason: input.reason ?? null,
  });
  if (result.ok !== true) {
    logEvent('workflow_transition_rpc_rejected', {
      clinicId,
      entityType,
      entityId,
      fromStatus,
      toStatus,
      reason: result.reason ?? 'unknown',
    });
    throw new WorkflowTransitionError('transition_conflict', entityType, fromStatus, toStatus);
  }

  return { ok: true, entityType, entityId, fromStatus, toStatus };
}