-- ============================================================================
-- 20260918_phase2_smart_booking.sql
-- PHASE 2 — Smart Scheduling + Advanced Booking.
--
-- ADDITIVE ONLY. Idempotent. Reversible. Non-destructive. No data touched.
--
-- 1) imaging_requests / lab_cases: + scheduled_at timestamptz NULL,
--    + provider_id uuid NULL (who performs the slot) — enables activity-aware
--    scheduling for imaging_center / dental_lab WITHOUT inventing availability
--    (scheduling still requires a REAL provider schedule to compute slots).
-- 2) appointment_waitlist — per-clinic waitlist for unavailable slots
--    (status: active | notified | booked | expired | cancelled).
--
-- RLS: both waitlist and the DHS activity tables stay service-role only
-- (same posture as billing_plans / workflow_audit) — all reads/writes happen
-- server-side via the service client.
-- Rollback:
--   drop table public.appointment_waitlist;
--   alter table public.imaging_requests drop column scheduled_at, drop column provider_id;
--   alter table public.lab_cases drop column scheduled_at, drop column provider_id;
-- ============================================================================
alter table public.imaging_requests add column if not exists scheduled_at timestamptz;
alter table public.imaging_requests add column if not exists provider_id uuid references public.providers(id) on delete set null;
alter table public.lab_cases add column if not exists scheduled_at timestamptz;
alter table public.lab_cases add column if not exists provider_id uuid references public.providers(id) on delete set null;

create table if not exists public.appointment_waitlist (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  service_id uuid,
  preferred_date date,
  preferred_window text check (preferred_window in ('morning','afternoon','evening','any')),
  contact_name text not null,
  contact_phone text not null,
  status text not null default 'active' check (status in ('active','notified','booked','expired','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_appointment_waitlist_clinic_status
  on public.appointment_waitlist (clinic_id, status, preferred_date);

alter table public.appointment_waitlist enable row level security;

drop policy if exists "appointment_waitlist service-role only" on public.appointment_waitlist;
create policy "appointment_waitlist service-role only"
  on public.appointment_waitlist
  for all
  using (app_is_super_admin())
  with check (app_is_super_admin());