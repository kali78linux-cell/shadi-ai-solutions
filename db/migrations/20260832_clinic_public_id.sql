-- STEP 15D — Clinic Public Page + QR
-- Opaque, stable, public identifier for QR links (/q/{public_id}).
-- clinic_id remains the internal tenant identity; slug remains the public display identity.
-- Additive only: new column + backfill + default + unique index. No RLS/policy changes.
-- Rollback: alter table public.clinics drop column if exists public_id;

alter table public.clinics add column if not exists public_id text;

-- backfill existing rows with a stable opaque token (32 hex chars, uuid-derived but not uuid-shaped)
update public.clinics
   set public_id = replace(gen_random_uuid()::text, '-', '')
 where public_id is null;

-- future inserts get an opaque token automatically
alter table public.clinics
  alter column public_id set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists clinics_public_id_key on public.clinics (public_id);

alter table public.clinics alter column public_id set not null;
