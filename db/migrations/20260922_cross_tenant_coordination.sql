-- ============================================================================
-- 20260922_cross_tenant_coordination.sql
-- Dental Imaging workflow: independent-organization relationships, referral
-- imaging requests (patient-linked + referring-clinic-linked), imaging results,
-- PRIVATE medical files, Stripe webhook idempotency ledger, and the
-- "one effective subscription per tenant" invariant.
--
-- ALL ADDITIVE: new tables + additive columns + indexes + a private bucket.
-- Nothing existing is altered destructively. Idempotent (safe re-run).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) organization_relationships — many-to-many between INDEPENDENT orgs.
--    Relationship lifecycle: requested / invited / accepted / rejected /
--    suspended. An imaging center is NEVER a child of a clinic.
-- ----------------------------------------------------------------------------
create table if not exists public.organization_relationships (
  id uuid primary key default gen_random_uuid(),
  source_org_id uuid not null references public.clinics(id) on delete cascade,
  target_org_id uuid not null references public.clinics(id) on delete cascade,
  relationship_type text not null default 'referral_partner'
    check (relationship_type in ('referral_partner','imaging_provider','lab_provider')),
  status text not null default 'requested'
    check (status in ('requested','invited','accepted','rejected','suspended')),
  created_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_org_relationship unique (source_org_id, target_org_id, relationship_type),
  constraint uq_org_relationship_no_self check (source_org_id <> target_org_id)
);

create index if not exists idx_org_rel_source
  on public.organization_relationships (source_org_id) where deleted_at is null;
create index if not exists idx_org_rel_target
  on public.organization_relationships (target_org_id) where deleted_at is null;

alter table public.organization_relationships enable row level security;

-- ----------------------------------------------------------------------------
-- 2) imaging_requests — additive columns for the referral workflow.
--    patient_id links the clinic-local patient record; referring_clinic_id
--    links the independent referring organization (no ownership tree).
-- ----------------------------------------------------------------------------
alter table public.imaging_requests
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists referring_clinic_id uuid references public.clinics(id) on delete set null,
  add column if not exists scheduled_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Widen the status domain preserving all legacy values (+ referral lifecycle).
alter table public.imaging_requests
  drop constraint if exists imaging_requests_status_check;

alter table public.imaging_requests
  add constraint imaging_requests_status_check check (
    status in (
      'requested','scheduled','in_progress','ready','delivered','cancelled',
      'draft','submitted','accepted','rejected','needs_clarification','completed'
    )
  );

create index if not exists idx_imaging_requests_patient
  on public.imaging_requests (patient_id) where deleted_at is null;
create index if not exists idx_imaging_requests_referrer
  on public.imaging_requests (referring_clinic_id) where deleted_at is null;
-- ----------------------------------------------------------------------------
-- 3) imaging_results — the COMPLETED study + report, delivered back ONLY to
--    the referring organization through the relationship.
-- ----------------------------------------------------------------------------
create table if not exists public.imaging_results (
  id uuid primary key default gen_random_uuid(),
  imaging_request_id uuid not null references public.imaging_requests(id) on delete cascade,
  imaging_center_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  referring_clinic_id uuid references public.clinics(id) on delete set null,
  status text not null default 'in_progress'
    check (status in ('in_progress','finalized','failed')),
  report_text text,
  report_file_id uuid,
  images jsonb not null default '[]', -- array of medical_file ids
  finalized_by uuid,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_imaging_results_request
  on public.imaging_results (imaging_request_id) where deleted_at is null;
create index if not exists idx_imaging_results_patient
  on public.imaging_results (patient_id) where deleted_at is null;
create index if not exists idx_imaging_results_referrer
  on public.imaging_results (referring_clinic_id) where deleted_at is null;

alter table public.imaging_results enable row level security;

-- ----------------------------------------------------------------------------
-- 4) medical_files — PRIVATE patient medical files. NEVER the public bucket.
--    Metadata here; binaries in the private `medical-files` bucket under
--    medical/{clinic_id}/{patient_id}/... Access = relationship + patient +
--    imaging request + role (authorized APIs + signed URLs only).
-- ----------------------------------------------------------------------------
create table if not exists public.medical_files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  imaging_request_id uuid references public.imaging_requests(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  file_type text not null check (
    file_type in ('image','video','pdf','document','medical_report','medical_image')
  ),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text not null,
  original_filename text,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_medical_files_path unique (clinic_id, storage_path)
);

create index if not exists idx_medical_files_patient
  on public.medical_files (patient_id) where deleted_at is null;
create index if not exists idx_medical_files_clinic
  on public.medical_files (clinic_id) where deleted_at is null;

alter table public.medical_files enable row level security;

-- Clinic members may read/manage medical files of their own tenant.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medical_files'
      and policyname = 'medical_files_tenant_all'
  ) then
    create policy medical_files_tenant_all
      on public.medical_files
      for all
      using (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      );
  end if;
end $$;
-- ----------------------------------------------------------------------------
-- 5) stripe_webhook_events — durable idempotency ledger. Same event delivered
--    twice/three times (or replayed later) is processed exactly once.
-- ----------------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  type text not null,
  clinic_id uuid references public.clinics(id) on delete set null,
  processed_at timestamptz not null default now(),
  outcome text not null default 'processed'
    check (outcome in ('processed','skipped','error'))
);

alter table public.stripe_webhook_events enable row level security;

-- ----------------------------------------------------------------------------
-- 6) ONE effective subscription per tenant (DB-enforced invariant).
--    Any attempt to create a second active subscription for the same clinic
--    fails at the database layer — the duplicate-checkout guard's backstop.
-- ----------------------------------------------------------------------------
create unique index if not exists uq_subscriptions_one_active_per_clinic
  on public.subscriptions (clinic_id)
  where status = 'active' and deleted_at is null;

-- ----------------------------------------------------------------------------
-- 7) PRIVATE storage bucket for medical files (public=false → no anonymous
--    access at all; retrieval exclusively via authenticated signed URLs).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medical-files',
  'medical-files',
  false,
  104857600, -- 100 MiB / file (video/DICOM-friendly)
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'application/pdf',
    'video/mp4','video/webm','video/quicktime',
    'application/dicom','application/octet-stream'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- REVERSIBILITY (documented; NOT executed by this migration):
--   drop table if exists medical_files;
--   drop table if exists imaging_results;
--   alter table imaging_requests drop column completed_at, drop column scheduled_at,
--     drop column referring_clinic_id, drop column patient_id;
--   drop table if exists organization_relationships;
--   drop table if exists stripe_webhook_events;
--   drop index if exists uq_subscriptions_one_active_per_clinic;
--   -- bucket removal requires the storage API/dashboard (no destructive SQL).
-- ----------------------------------------------------------------------------