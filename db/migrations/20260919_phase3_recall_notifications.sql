-- ============================================================================
-- 20260919_phase3_recall_notifications.sql
-- PHASE 3 — Patient Recall + Advanced Notifications.
--
-- ADDITIVE ONLY. Idempotent. Reversible. Non-destructive. No existing row,
-- column, or constraint is modified. NOTE: the live template_type CHECK in
-- clinic_notification_templates ALREADY includes 'recall' (+ no_show_recovery,
-- waitlist_offer) — the recall engine uses the EXISTING 'recall' template
-- type, so the constraint is deliberately left untouched.
--
-- Adds:
--   1) patient_notification_preferences — per-patient channel preferences,
--      global opt-out, and a do-not-disturb window (server-side enforced).
--   2) recall_rules — clinic-level recall policy (enabled, interval_days,
--      channels). One row per clinic (unique).
--   3) recall_assignments — one recall per patient per cycle (status:
--      pending | notified | done | cancelled), deduped by a partial unique
--      index so a patient never receives two active recalls.
--
-- RLS: all three tables are service-role only (same posture as
-- billing_plans / workflow_audit / appointment_waitlist) — every read/write
-- happens server-side via the service client.
-- Rollback:
--   drop table recall_assignments; drop table recall_rules;
--   drop table patient_notification_preferences;
-- ============================================================================

-- 1) Per-patient notification preferences (opt-out + DND).
create table if not exists public.patient_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  opt_out boolean not null default false,
  channels jsonb not null default '["whatsapp","sms","email"]'::jsonb,
  dnd_start text, -- 'HH:MM' UTC or null
  dnd_end   text,
  updated_at timestamptz not null default now(),
  unique (clinic_id, patient_id)
);

create index if not exists idx_patient_notif_prefs_clinic
  on public.patient_notification_preferences (clinic_id);

-- 3) Clinic-level recall policy.
create table if not exists public.recall_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references public.clinics(id) on delete cascade,
  enabled boolean not null default true,
  interval_days integer not null default 180 check (interval_days between 7 and 1095),
  channels jsonb not null default '["whatsapp","sms","email"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) One recall per patient per cycle (partial unique dedupe).
create table if not exists public.recall_assignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  interval_days integer not null,
  last_visit_date date,
  status text not null default 'pending'
    check (status in ('pending','notified','done','cancelled')),
  scheduled_at timestamptz not null default now(),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recall_assignments_clinic_status
  on public.recall_assignments (clinic_id, status, scheduled_at);

-- A patient can have at most ONE active (pending/notified) recall at a time.
create unique index if not exists uq_recall_assignments_active_patient
  on public.recall_assignments (clinic_id, patient_id)
  where status in ('pending','notified');

alter table public.patient_notification_preferences enable row level security;
alter table public.recall_rules enable row level security;
alter table public.recall_assignments enable row level security;

drop policy if exists "patient_notif_prefs service-role only" on public.patient_notification_preferences;
create policy "patient_notif_prefs service-role only"
  on public.patient_notification_preferences for all
  using (app_is_super_admin()) with check (app_is_super_admin());

drop policy if exists "recall_rules service-role only" on public.recall_rules;
create policy "recall_rules service-role only"
  on public.recall_rules for all
  using (app_is_super_admin()) with check (app_is_super_admin());

drop policy if exists "recall_assignments service-role only" on public.recall_assignments;
create policy "recall_assignments service-role only"
  on public.recall_assignments for all
  using (app_is_super_admin()) with check (app_is_super_admin());