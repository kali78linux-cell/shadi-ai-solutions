-- ============================================================================
-- 20260917_phase1b_workflow_transitions.sql
-- PHASE 1B — Workflow-Directed Transitions.
--
-- ADDITIVE ONLY. No new tables, no column changes, no data touched.
-- workflow_audit (20260916) is reused as-is. Idempotent (create or replace).
-- Reversible: drop function public.apply_workflow_transition(text, uuid, uuid, text, text, uuid, text, text);
--
-- apply_workflow_transition(): ONE atomic SECURITY DEFINER transaction that
--   1) performs the GUARDED optimistic update (status = p_from_status) so
--      concurrent/conflicting transitions serialize on the row — the loser
--      gets ok=false / transition_conflict instead of a silent overwrite;
--   2) inserts the immutable workflow_audit row in the SAME transaction —
--      a transition is never applied without its audit record (fail-closed).
-- The machine validation (allowed edges, terminal states, activity ownership)
-- lives in lib/services/workflowService.ts — the rpc is the last-line guard:
-- the DB check constraints (20260914) still reject any invalid status value.
-- ============================================================================
create or replace function public.apply_workflow_transition(
  p_clinic_id           uuid,
  p_entity_type         text,
  p_entity_id           uuid,
  p_from_status         text,
  p_to_status           text,
  p_actor_clinic_user_id uuid default null,
  p_actor_role          text default null,
  p_reason              text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_entity_type = 'imaging_requests' then
    update public.imaging_requests
       set status = p_to_status
     where id = p_entity_id
       and clinic_id = p_clinic_id
       and status = p_from_status
       and deleted_at is null
    returning id, status into v_row;
  elsif p_entity_type = 'lab_cases' then
    update public.lab_cases
       set status = p_to_status
     where id = p_entity_id
       and clinic_id = p_clinic_id
       and status = p_from_status
       and deleted_at is null
    returning id, status into v_row;
  else
    return json_build_object('ok', false, 'reason', 'unknown_entity');
  end if;

  if v_row is null then
    return json_build_object('ok', false, 'reason', 'transition_conflict');
  end if;

  insert into public.workflow_audit
    (clinic_id, entity_type, entity_id, from_status, to_status, actor_clinic_user_id, actor_role, reason)
  values
    (p_clinic_id, p_entity_type, p_entity_id, p_from_status, p_to_status, p_actor_clinic_user_id, p_actor_role, p_reason);

  return json_build_object('ok', true, 'status', v_row.status);
end;
$$;