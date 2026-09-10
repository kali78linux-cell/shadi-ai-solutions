-- ============================================================================
-- CLINIC PUBLIC MEDIA — tenant-scoped public gallery infrastructure
-- ============================================================================
-- Canonical storage for owner-uploaded public-page media (images/videos).
-- Design decisions:
--   * Binaries live in Supabase Storage (bucket: clinic-public-media), never
--     in Postgres. This table holds metadata only.
--   * Storage path isolation: every object lives under
--     clinic/{clinic_id}/public-media/... (enforced by storage RLS policy
--     below and re-validated server-side in the upload API).
--   * Public page reads ONLY enabled rows (visibility flag), through the
--     service layer — never raw table access from anonymous clients beyond
--     the restrictive RLS here.
--   * Idempotent + reversible (see DROP section).
-- ============================================================================

create table if not exists clinic_public_media (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  storage_path text not null,
  public_url text not null,
  title text,
  caption text,
  alt_text text,
  display_order integer not null default 0,
  enabled boolean not null default true,
  file_size_bytes bigint,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table clinic_public_media is
  'Owner-managed public-page media metadata. Binaries in Supabase Storage bucket clinic-public-media under clinic/{clinic_id}/public-media/.';

create index if not exists idx_clinic_public_media_clinic
  on clinic_public_media (clinic_id, display_order);

-- Idempotent duplicate-path guard per tenant.
create unique index if not exists uq_clinic_public_media_path
  on clinic_public_media (clinic_id, storage_path);

-- ----------------------------------------------------------------------------
-- RLS: strict tenant isolation. No public/anonymous access; the application
-- uses the service client server-side (service_role bypasses RLS), and the
-- public page reads through the same tenant-scoped service functions.
-- ----------------------------------------------------------------------------
alter table clinic_public_media enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_public_media'
      and policyname = 'clinic_public_media_tenant_all'
  ) then
    create policy clinic_public_media_tenant_all
      on clinic_public_media
      for all
      using (
        clinic_id in (
          select cu.clinic_id from clinic_users cu
          where cu.user_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select cu.clinic_id from clinic_users cu
          where cu.user_id = auth.uid()
        )
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Storage bucket + object isolation (idempotent).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-public-media',
  'clinic-public-media',
  true,
  26214400, -- 25 MiB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner-facing object policy: a signed-in clinic member may only touch
-- objects inside their own tenant prefix. (Service-role writes bypass this.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinic_public_media_tenant_objects'
  ) then
    create policy clinic_public_media_tenant_objects
      on storage.objects for all to authenticated
      using (
        bucket_id = 'clinic-public-media'
        and (storage.foldername(name))[1] = 'clinic'
        and (storage.foldername(name))[2] in (
          select cu.clinic_id::text from clinic_users cu where cu.user_id = auth.uid()
        )
      )
      with check (
        bucket_id = 'clinic-public-media'
        and (storage.foldername(name))[1] = 'clinic'
        and (storage.foldername(name))[2] in (
          select cu.clinic_id::text from clinic_users cu where cu.user_id = auth.uid()
        )
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- REVERSIBILITY (documented; NOT executed by this migration):
--   drop policy if exists clinic_public_media_tenant_objects on storage.objects;
--   drop policy if exists clinic_public_media_tenant_all on clinic_public_media;
--   drop table if exists clinic_public_media;
--   -- bucket removal requires storage API/dashboard (no destructive SQL here)
-- ----------------------------------------------------------------------------
