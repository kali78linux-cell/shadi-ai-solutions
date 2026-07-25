-- Production SaaS schema migration for dental AI platform
-- Adds updated_at, soft deletes, appointment scheduling, stronger role handling, billing fields, provider/staff, notifications, and audit logging.

create extension if not exists "pgcrypto";

-- audit timestamp helper
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- role enum for clinic users and subscription/billing states
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clinic_user_role') THEN
    CREATE TYPE public.clinic_user_role AS ENUM ('owner', 'admin', 'receptionist');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE public.subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing', 'unpaid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
    CREATE TYPE public.notification_channel AS ENUM ('email', 'sms');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE public.notification_type AS ENUM ('appointment_reminder', 'billing', 'system');
  END IF;
END;
$$ LANGUAGE plpgsql;

alter table public.clinics
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.clinic_users
  alter column role type public.clinic_user_role using (
    case
      when role = 'owner' then 'owner'
      when role = 'admin' then 'admin'
      else 'receptionist'
    end
  )::public.clinic_user_role,
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.patients
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.leads
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.appointments
  add column scheduled_at timestamptz,
  add column duration_minutes int default 30 not null,
  add column status text not null default 'scheduled',
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.conversations
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.messages
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.knowledge_base
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

alter table public.subscriptions
  alter column status type public.subscription_status using (
    case
      when status in ('active', 'past_due', 'canceled', 'trialing', 'unpaid') then status::public.subscription_status
      else 'active'::public.subscription_status
    end
  ),
  add column plan_id text not null default 'default',
  add column billing_status text not null default 'active',
  add column current_period_start timestamptz,
  add column current_period_end timestamptz,
  add column trial_end timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

-- new tables for production SaaS
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null,
  provider_type text not null check (provider_type in ('dentist', 'hygienist', 'staff')),
  name text not null,
  title text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.appointments
  add column provider_id uuid references public.providers(id) on delete set null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid,
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  channel public.notification_channel not null default 'email',
  type public.notification_type not null default 'appointment_reminder',
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  user_id uuid,
  action text not null,
  resource text,
  resource_id uuid,
  details jsonb default '{}'::jsonb,
  severity text not null default 'info',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- updated indexes
create index idx_clinic_users_clinic_id on public.clinic_users(clinic_id);
create index idx_clinic_users_user_id on public.clinic_users(user_id);
create unique index idx_patients_clinic_id_email on public.patients(clinic_id, lower(email));
create index idx_leads_clinic_id_status on public.leads(clinic_id, status);
create index idx_leads_patient_id on public.leads(patient_id);
create index idx_appointments_clinic_id_date_status on public.appointments(clinic_id, status, appointment_date);
create index idx_appointments_clinic_id_patient_id on public.appointments(clinic_id, patient_id);
create index idx_conversations_clinic_id on public.conversations(clinic_id);
create index idx_conversations_session_id on public.conversations(session_id);
create index idx_messages_conversation_id_created_at on public.messages(conversation_id, created_at);
create index idx_knowledge_base_clinic_id on public.knowledge_base(clinic_id);
create index idx_subscriptions_clinic_id on public.subscriptions(clinic_id);
create index idx_providers_clinic_id on public.providers(clinic_id);
create index idx_notifications_clinic_id on public.notifications(clinic_id);
create index idx_notifications_appointment_id on public.notifications(appointment_id);
create index idx_providers_user_id on public.providers(user_id);
create index idx_audit_logs_clinic_id on public.audit_logs(clinic_id);
create index idx_audit_logs_user_id on public.audit_logs(user_id);

-- triggers for automatic timestamp updates
create trigger set_updated_at_clinics
  before update on public.clinics
  for each row execute function public.set_updated_at();

create trigger set_updated_at_clinic_users
  before update on public.clinic_users
  for each row execute function public.set_updated_at();

create trigger set_updated_at_patients
  before update on public.patients
  for each row execute function public.set_updated_at();

create trigger set_updated_at_leads
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger set_updated_at_appointments
  before update on public.appointments
  for each row execute function public.set_updated_at();

create trigger set_updated_at_conversations
  before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger set_updated_at_messages
  before update on public.messages
  for each row execute function public.set_updated_at();

create trigger set_updated_at_knowledge_base
  before update on public.knowledge_base
  for each row execute function public.set_updated_at();

create trigger set_updated_at_subscriptions
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create trigger set_updated_at_providers
  before update on public.providers
  for each row execute function public.set_updated_at();

create trigger set_updated_at_notifications
  before update on public.notifications
  for each row execute function public.set_updated_at();

create trigger set_updated_at_audit_logs
  before update on public.audit_logs
  for each row execute function public.set_updated_at();

-- RLS: allow clinic owners/admins to manage staff and tenancy data
create or replace function public.app_user_can_manage_clinic_users(clinic uuid) returns boolean as $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = clinic
      and cu.user_id = auth.uid()::uuid
      and cu.role in ('owner', 'admin')
      and cu.deleted_at is null
  );
$$ language sql stable;

create or replace function public.app_user_is_active_clinic_member(clinic uuid) returns boolean as $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = clinic
      and cu.user_id = auth.uid()::uuid
      and cu.deleted_at is null
  );
$$ language sql stable;

alter table public.clinics enable row level security;
alter table public.clinic_users enable row level security;
alter table public.patients enable row level security;
alter table public.leads enable row level security;
alter table public.appointments enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.knowledge_base enable row level security;
alter table public.subscriptions enable row level security;
alter table public.providers enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Clinics policies
create policy "Clinics can be selected by clinic members or super admin" on public.clinics for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(id)
);
create policy "Clinics can be inserted by super admin only" on public.clinics for insert with check (
  app_is_super_admin()
);
create policy "Clinics can be updated by super admin only" on public.clinics for update using (
  app_is_super_admin()
) with check (
  app_is_super_admin()
);
create policy "Clinics can be deleted by super admin only" on public.clinics for delete using (
  app_is_super_admin()
);

-- Clinic users policies
create policy "Clinic users can select memberships for self or clinic" on public.clinic_users for select using (
  app_is_super_admin()
  or user_id = app_current_user_id()
  or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic memberships can be managed by clinic owners and admins" on public.clinic_users for insert with check (
  app_is_super_admin() or app_user_can_manage_clinic_users(clinic_id)
);
create policy "Clinic memberships can be updated by clinic owners and admins" on public.clinic_users for update using (
  app_is_super_admin() or app_user_can_manage_clinic_users(clinic_id)
) with check (
  app_is_super_admin() or app_user_can_manage_clinic_users(clinic_id)
);
create policy "Clinic memberships can be deleted by clinic owners and admins" on public.clinic_users for delete using (
  app_is_super_admin() or app_user_can_manage_clinic_users(clinic_id)
);

-- Tenanted data policies
create policy "Clinic patients can be accessed by clinic members" on public.patients for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic patients can be modified by active clinic members" on public.patients for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic patients can be updated by active clinic members" on public.patients for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic patients can be deleted by active clinic members" on public.patients for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic leads can be accessed by clinic members" on public.leads for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic leads can be modified by active clinic members" on public.leads for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic leads can be updated by active clinic members" on public.leads for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic leads can be deleted by active clinic members" on public.leads for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic appointments can be accessed by clinic members" on public.appointments for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic appointments can be modified by active clinic members" on public.appointments for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic appointments can be updated by active clinic members" on public.appointments for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic appointments can be deleted by active clinic members" on public.appointments for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic conversations can be accessed by clinic members" on public.conversations for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic conversations can be modified by active clinic members" on public.conversations for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic conversations can be updated by active clinic members" on public.conversations for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic conversations can be deleted by active clinic members" on public.conversations for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic messages can be accessed by clinic members" on public.messages for select using (
  app_is_super_admin()
  or exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and app_user_is_active_clinic_member(c.clinic_id)
  )
);
create policy "Clinic messages can be modified by clinic members" on public.messages for insert with check (
  app_is_super_admin()
  or exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and app_user_is_active_clinic_member(c.clinic_id)
  )
);
create policy "Clinic messages can be updated by clinic members" on public.messages for update using (
  app_is_super_admin()
  or exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and app_user_is_active_clinic_member(c.clinic_id)
  )
) with check (
  app_is_super_admin()
  or exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and app_user_is_active_clinic_member(c.clinic_id)
  )
);
create policy "Clinic messages can be deleted by clinic members" on public.messages for delete using (
  app_is_super_admin()
  or exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and app_user_is_active_clinic_member(c.clinic_id)
  )
);

create policy "Clinic knowledge articles can be accessed by clinic members" on public.knowledge_base for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic knowledge articles can be modified by active clinic members" on public.knowledge_base for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic knowledge articles can be updated by active clinic members" on public.knowledge_base for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic knowledge articles can be deleted by active clinic members" on public.knowledge_base for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic subscriptions can be accessed by clinic members" on public.subscriptions for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic subscriptions can be managed by active clinic members" on public.subscriptions for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic subscriptions can be updated by active clinic members" on public.subscriptions for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic subscriptions can be deleted by active clinic members" on public.subscriptions for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic providers can be accessed by clinic members" on public.providers for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic providers can be managed by active clinic members" on public.providers for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic providers can be updated by active clinic members" on public.providers for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic providers can be deleted by active clinic members" on public.providers for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic notifications can be accessed by clinic members" on public.notifications for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic notifications can be created by active clinic members" on public.notifications for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic notifications can be updated by active clinic members" on public.notifications for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic notifications can be deleted by active clinic members" on public.notifications for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);

create policy "Clinic audit logs can be accessed by clinic members" on public.audit_logs for select using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic audit logs can be created by active clinic members" on public.audit_logs for insert with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic audit logs can be updated by active clinic members" on public.audit_logs for update using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
) with check (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
create policy "Clinic audit logs can be deleted by active clinic members" on public.audit_logs for delete using (
  app_is_super_admin() or app_user_is_active_clinic_member(clinic_id)
);
