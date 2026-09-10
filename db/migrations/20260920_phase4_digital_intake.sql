-- ============================================================================
-- 20260920_phase4_digital_intake.sql
-- PHASE 4 — Digital Intake + Patient Portal Integration.
--
-- ADDITIVE ONLY. Idempotent. Reversible. Non-destructive.
--
-- Adds:
--   1) intake_forms     — clinic-defined intake forms. `form_schema` is a JSONB
--                         array of field definitions
--                         ({ key, label, type: text|number|boolean|date|select|multi_select,
--                            required?, options?, max_length? }).
--                         Validation happens SERVER-SIDE in intakeService.ts —
--                         the schema is data, the enforcement is code.
--   2) intake_responses — patient submissions (answers JSONB validated against
--                         the form schema before persisting; status:
--                         draft | submitted; optional appointment link).
--   3) intake_consents  — e-consent signatures (patient, form, consent text,
--                         version, signed_at) captured at submission time.
--
-- RLS: service-role only (same posture as billing_plans / workflow_audit) —
-- portal access is authorized by authorizePatientRequest (session identity),
-- staff access by authorizeClinicRequest + roleDenied. Client input is never
-- trusted; patient_id/clinic_id are always derived server-side.
-- Rollback:
--   drop table intake_consents; drop table intake_responses; drop table intake_forms;
-- ============================================================================

create table if not exists public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null,
  description text,
  form_schema jsonb not null default '[]'::jsonb,
  consent_text text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_intake_forms_clinic
  on public.intake_forms (clinic_id, active);

create table if not exists public.intake_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  form_id uuid not null references public.intake_forms(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_intake_responses_clinic_form
  on public.intake_responses (clinic_id, form_id, status);
create index if not exists idx_intake_responses_patient
  on public.intake_responses (patient_id, status);

create table if not exists public.intake_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  form_id uuid not null references public.intake_forms(id) on delete cascade,
  consent_text text not null,
  version integer not null default 1,
  signed_at timestamptz not null default now()
);

create index if not exists idx_intake_consents_patient
  on public.intake_consents (clinic_id, patient_id);

alter table public.intake_forms enable row level security;
alter table public.intake_responses enable row level security;
alter table public.intake_consents enable row level security;

drop policy if exists "intake_forms service-role only" on public.intake_forms;
create policy "intake_forms service-role only"
  on public.intake_forms for all
  using (app_is_super_admin()) with check (app_is_super_admin());

drop policy if exists "intake_responses service-role only" on public.intake_responses;
create policy "intake_responses service-role only"
  on public.intake_responses for all
  using (app_is_super_admin()) with check (app_is_super_admin());

drop policy if exists "intake_consents service-role only" on public.intake_consents;
create policy "intake_consents service-role only"
  on public.intake_consents for all
  using (app_is_super_admin()) with check (app_is_super_admin());