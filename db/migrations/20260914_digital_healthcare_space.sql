-- ============================================================================
-- 20260914_digital_healthcare_space.sql
-- Digital Healthcare Space — activity model + minimal domain foundations.
--
-- AUTHORITATIVE product decision: the platform has EXACTLY THREE activity types:
--   clinic · imaging_center · dental_lab   (there is NO generic medical_lab)
--
-- PHASE A — activity model:
--   * new strict enum activity_type
--   * clinics.activity_type NOT NULL DEFAULT 'clinic' (additive)
--   * SAFE backfill: existing tenants cannot be reliably classified from
--     free-text settings.clinic_type or service names → they all remain 'clinic'
--     (deny-invention rule). Existing tenants are preserved untouched.
--   * settings.clinic_type is DEPRECATED as the authoritative discriminator
--     (kept only as legacy display text).
--
-- PHASE D — minimal additive domain tables (tenant-scoped, service-role only):
--   * imaging_services  — imaging center service catalog (modality-aware)
--   * imaging_requests  — operational request concept for imaging centers
--   * lab_services      — dental lab service catalog (turnaround-aware)
--   * lab_cases         — dental lab case/work-request concept
--   All: clinic_id scoped (same tenant isolation), RLS enabled with NO policies
--   (service-role only — matches the project's privileged-client pattern), and
--   soft-delete via deleted_at.
--
-- Rollback:
--   drop table lab_cases; drop table lab_services;
--   drop table imaging_requests; drop table imaging_services;
--   alter table clinics drop column activity_type; drop type activity_type;
-- ============================================================================

create type public.activity_type as enum ('clinic', 'imaging_center', 'dental_lab');

alter table public.clinics
  add column if not exists activity_type public.activity_type not null default 'clinic';

-- ---------------------------------------------------------------------------
-- Imaging center domain (additive)
-- ---------------------------------------------------------------------------
create table if not exists public.imaging_services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  modality text,
  description text,
  duration_minutes integer,
  price integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.imaging_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_ref text,
  requested_service text,
  modality text,
  status text not null default 'requested' check (status in ('requested','scheduled','in_progress','ready','delivered','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Dental lab domain (additive)
-- ---------------------------------------------------------------------------
create table if not exists public.lab_services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  description text,
  turnaround_hours integer,
  price integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.lab_cases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  case_ref text,
  referring_clinic text,
  requested_service text,
  status text not null default 'received' check (status in ('received','in_production','quality_check','ready','delivered','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Tenant isolation + security: enable RLS, NO policies (service-role only).
-- ---------------------------------------------------------------------------
alter table public.imaging_services enable row level security;
alter table public.imaging_requests enable row level security;
alter table public.lab_services enable row level security;
alter table public.lab_cases enable row level security;
