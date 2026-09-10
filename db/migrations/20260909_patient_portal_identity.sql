-- PP-1: PATIENT PORTAL IDENTITY (D-PP1) — additive, idempotent
-- Portal identity links an authenticated Supabase user to exactly one
-- patient within one clinic. booking_token remains a separate mechanism.
create table if not exists public.clinic_patient_identities (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  patient_id  uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null,
  status      text not null default 'active'
              check (status in ('active', 'revoked')),
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint fk_ppi_patient
    foreign key (clinic_id, patient_id)
    references public.patients (clinic_id, id) on delete cascade,
  constraint ck_ppi_verified_active check (
    status <> 'active' or verified_at is not null
  )
);

-- V1: one active identity per user (single patient per portal user)
create unique index if not exists uq_ppi_user_active
  on public.clinic_patient_identities (user_id)
  where status = 'active' and deleted_at is null;

-- one active identity per patient per clinic (no duplicates)
create unique index if not exists uq_ppi_patient_active
  on public.clinic_patient_identities (clinic_id, patient_id)
  where status = 'active' and deleted_at is null;

create index if not exists idx_ppi_user_lookup
  on public.clinic_patient_identities (user_id, status)
  where deleted_at is null;

-- RLS: service-role writes only; portal reads via API authorization layer
alter table public.clinic_patient_identities enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_patient_identities'
  ) then
    create policy ppi_deny_all_public on public.clinic_patient_identities
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

-- Portal authorization helper (mirrors app_user_is_active_clinic_member)
create or replace function public.app_user_is_active_patient_identity(
  clinic uuid, patient uuid
) returns boolean as $$
  select exists (
    select 1
    from public.clinic_patient_identities pi
    where pi.clinic_id = clinic
      and pi.patient_id = patient
      and pi.user_id = auth.uid()::uuid
      and pi.status = 'active'
      and pi.deleted_at is null
      and pi.verified_at is not null
  );
$$ language sql stable;
