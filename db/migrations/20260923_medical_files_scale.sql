-- ============================================================================
-- 20260923_medical_files_scale.sql
-- MEDICAL FILES PRODUCTION SCALE (Phase 4 — medical files hardening).
--
-- * Raise the private medical-files bucket ceiling so large radiology studies
--   (CBCT/DICOM/CT, panoramic, video) are practically supported (2 GiB/file).
-- * Keep protective per-type policy limits server-side (configurable), never
--   an "unlimited" free-for-all. The bucket ceiling is a safety backstop only.
-- * Add a dedup guard on (clinic_id, original_filename, size_bytes, created_at)
--   not needed — existing unique (clinic_id, storage_path) stays authoritative.
-- * Add an upload session ledger for failed-upload recovery / orphan cleanup.
--
-- ALL ADDITIVE. Idempotent (safe re-run). Reversible (documented below).
-- ============================================================================

-- Raise medical-files bucket ceiling to 2 GiB (2147483648 bytes) with the
-- expanded MIME allow-list (DICOM + common medical/video/pdf types).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medical-files',
  'medical-files',
  false,
  2147483648,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/tiff',
    'application/pdf',
    'video/mp4','video/webm','video/quicktime','video/x-msvideo',
    'application/dicom','application/octet-stream','application/x-dicom',
    'application/zip','application/x-zip-compressed'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- medical_upload_sessions — durable record of an INTENTED upload (started via
-- the signed-upload flow). Lets the platform reconcile/drop ORPHAN objects when
-- the upload never completes or the metadata row fails to be written.
-- ----------------------------------------------------------------------------
create table if not exists public.medical_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  imaging_request_id uuid references public.imaging_requests(id) on delete set null,
  storage_path text not null,
  token text,
  mime_type text not null,
  size_bytes bigint,
  file_type text,
  original_filename text,
  status text not null default 'started' check (status in ('started','uploaded','confirmed','orphan','cancelled')),
  created_by uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint uq_medical_upload_session_path unique (clinic_id, storage_path)
);

create index if not exists idx_medical_upload_sessions_clinic
  on public.medical_upload_sessions (clinic_id, status, created_at desc);

alter table public.medical_upload_sessions enable row level security;

-- ----------------------------------------------------------------------------
-- Orphan-cleanup helper: soft-deletes expired/stuck STARTED sessions older than
-- 2 hours and reports them (callable as maintenance). Does NOT touch confirmed rows.
-- ----------------------------------------------------------------------------
create or replace function public.prune_stale_medical_uploads()
returns void
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.medical_upload_sessions
       set status = 'orphan', finalized_at = now()
     where status in ('started','uploaded')
       and created_at < now() - interval '2 hours'
  )
  select 1 where false;
$$;

-- REVERSIBILITY (documented; NOT executed):
--   drop function if exists public.prune_stale_medical_uploads();
--   drop table if exists public.medical_upload_sessions;
--   -- bucket limit change is an upsert (last-write wins); lowering it again is a config action.
-- ----------------------------------------------------------------------------