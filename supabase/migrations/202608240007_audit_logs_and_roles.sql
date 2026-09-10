-- Additive, safe: new table + enum value + RLS. No destructive changes.
begin;

-- Extend the clinic role enum with the roles the application layer already
-- recognizes (RBAC phase). Enum addition is safe and non-reversible by design.
alter type public.clinic_user_role add value if not exists 'manager';
alter type public.clinic_user_role add value if not exists 'doctor';
alter type public.clinic_user_role add value if not exists 'staff';
alter type public.clinic_user_role add value if not exists 'accountant';

-- Central, immutable-from-client audit trail, scoped per clinic.
-- Idempotent: repairs partially-created tables from interrupted runs.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Repair path for pre-existing incomplete tables (additive only).
alter table public.audit_logs add column if not exists clinic_id uuid;
alter table public.audit_logs add column if not exists actor_user_id uuid;
alter table public.audit_logs add column if not exists action text;
alter table public.audit_logs add column if not exists resource_type text not null default '';
alter table public.audit_logs add column if not exists resource_id text not null default '';
alter table public.audit_logs add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.audit_logs add column if not exists created_at timestamptz not null default now();

create index if not exists idx_audit_logs_clinic_created
  on public.audit_logs (clinic_id, created_at desc);
create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_user_id);

-- RLS: admins read their own clinic's logs; inserts happen only through the
-- server (service role bypasses RLS). Clients can never update or delete.
alter table public.audit_logs enable row level security;

create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.clinic_id = audit_logs.clinic_id
        and cu.user_id = auth.uid()
        and cu.deleted_at is null
        and cast(cu.role as text) in ('owner','manager')
    )
  );

-- No insert/update/delete policies for authenticated/anon:
-- clients cannot forge or tamper with audit entries. Server writes use the
-- service-role client which bypasses RLS.

commit;