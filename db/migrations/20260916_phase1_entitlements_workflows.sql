-- ============================================================================
-- 20260916_phase1_entitlements_workflows.sql
-- PHASE 1 — Activity-Specific Entitlements + Workflow-Directed Transitions.
--
-- Additive only. No destructive changes. No RLS policies (service-role only,
-- matching the established project pattern). Idempotent. Reversible.
--
-- ENTITLEMENTS:
--   * activity_capabilities  : registry of capabilities that can be
--                              activity-specific (capability_key, label,
--                              applies_to activity_type[])
--   * plan_activity_caps     : per-plan, per-activity cap grant.
--                              ENFORCEMENT SEMANTICS (approved, PHASE 1A):
--                                limit_value = number -> that limit
--                                limit_value = NULL   -> unlimited (explicit grant)
--                                row ABSENT           -> fail-closed DENY
--                              Resolution/rpc infrastructure errors also DENY
--                              (fail-closed) for activity-specific caps, while
--                              the 15C standard caps keep their approved
--                              fail-open posture (documented asymmetry).
--                              Seeded below for every active billing plan so
--                              imaging_center/dental_lab tenants are entitled
--                              by default; ops can tighten per plan anytime.
--
-- WORKFLOWS:
--   * workflow_audit         : immutable audit trail of status transitions
--                              (entity, from/to, actor, reason, timestamp).
--                              No transitions table (transitions are an
--                              enforced code-level state machine — see
--                              lib/services/workflowEngine.ts).
-- Rollback:
--   drop table workflow_audit; drop table plan_activity_caps;
--   drop table activity_capabilities;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Capability registry (static-ish reference data)
-- ---------------------------------------------------------------------------
create table if not exists public.activity_capabilities (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null unique,
  label text not null,
  applies_to activity_type[] not null,
  standard_cap boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed canonical activity-specific capabilities.
insert into public.activity_capabilities (capability_key, label, applies_to, standard_cap) values
  ('imaging_services_limit',     'Imaging Services Limit',     array['imaging_center']::activity_type[], false),
  ('imaging_requests_limit',     'Imaging Requests Limit',     array['imaging_center']::activity_type[], false),
  ('lab_services_limit',         'Dental Lab Services Limit',  array['dental_lab']::activity_type[],     false),
  ('lab_cases_limit',            'Dental Lab Cases Limit',     array['dental_lab']::activity_type[],     false)
on conflict (capability_key) do nothing;

-- ---------------------------------------------------------------------------
-- Per-plan, per-activity cap overrides. Standard caps live in billing_plans.limits
-- and are untouched. This table adds activity-specific dimensions only.
-- ---------------------------------------------------------------------------
create table if not exists public.plan_activity_caps (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references public.billing_plans(plan_id) on delete cascade,
  activity_type activity_type not null,
  capability_key text not null,
  limit_value integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, activity_type, capability_key)
);

create index if not exists idx_plan_activity_caps_plan
  on public.plan_activity_caps (plan_id, activity_type);

-- Seed per-plan activity cap grants (only for plans that exist and are active;
-- idempotent; existing overrides are never overwritten).
insert into public.plan_activity_caps (plan_id, activity_type, capability_key, limit_value)
select v.plan_id, v.activity_type::activity_type, v.capability_key, v.limit_value
from (values
  ('free_trial', 'imaging_center', 'imaging_services_limit', 3::int),
  ('free_trial', 'imaging_center', 'imaging_requests_limit', 50),
  ('free_trial', 'dental_lab',     'lab_services_limit',     5),
  ('free_trial', 'dental_lab',     'lab_cases_limit',        30),
  ('starter',    'imaging_center', 'imaging_services_limit', 3),
  ('starter',    'imaging_center', 'imaging_requests_limit', 50),
  ('starter',    'dental_lab',     'lab_services_limit',     5),
  ('starter',    'dental_lab',     'lab_cases_limit',        30),
  ('growth',     'imaging_center', 'imaging_services_limit', 10),
  ('growth',     'imaging_center', 'imaging_requests_limit', 200),
  ('growth',     'dental_lab',     'lab_services_limit',     15),
  ('growth',     'dental_lab',     'lab_cases_limit',        100),
  ('pro',        'imaging_center', 'imaging_services_limit', null::int),
  ('pro',        'imaging_center', 'imaging_requests_limit', null),
  ('pro',        'dental_lab',     'lab_services_limit',     null),
  ('pro',        'dental_lab',     'lab_cases_limit',        null),
  ('founding',   'imaging_center', 'imaging_services_limit', null),
  ('founding',   'imaging_center', 'imaging_requests_limit', null),
  ('founding',   'dental_lab',     'lab_services_limit',     null),
  ('founding',   'dental_lab',     'lab_cases_limit',        null)
) as v(plan_id, activity_type, capability_key, limit_value)
join public.billing_plans bp
  on bp.plan_id = v.plan_id and bp.is_active = true
on conflict (plan_id, activity_type, capability_key) do nothing;

-- ---------------------------------------------------------------------------
-- Workflow audit trail (immutable).
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_audit (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  entity_type text not null,  -- imaging_request | lab_case
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  actor_clinic_user_id uuid,
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_workflow_audit_entity
  on public.workflow_audit (entity_type, entity_id, created_at desc);

alter table public.workflow_audit enable row level security;
