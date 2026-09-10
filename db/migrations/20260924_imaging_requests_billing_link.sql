-- ============================================================================
-- 20260924_imaging_requests_billing_link.sql
-- IMAGING WORKFLOW → BILLING LINK (additive, idempotent, reversible).
--
-- imaging_requests gains the structured fields required by the referral/billing
-- contract (service_id, referring_provider_id, priority, appointment link) and
-- an explicit imaging-performance status so accounting depends on
-- "imaging performed" — never on the mere existence of an appointment.
--
-- NOTHING existing is altered destructively. Existing rows keep their values
-- (new columns nullable/defaulted).
-- ============================================================================

alter table public.imaging_requests
  add column if not exists service_id uuid references public.clinic_services(id) on delete set null,
  add column if not exists referring_provider_id uuid references public.providers(id) on delete set null,
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists priority text not null default 'routine'
    check (priority in ('routine','urgent')),
  add column if not exists imaging_status text not null default 'not_performed'
    check (imaging_status in ('not_performed','arrived_not_performed','in_progress','performed','cancelled','no_show'));

create index if not exists idx_imaging_requests_service
  on public.imaging_requests (service_id) where deleted_at is null;
create index if not exists idx_imaging_requests_imaging_status
  on public.imaging_requests (imaging_status) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- REVERSIBILITY (documented; NOT executed):
--   alter table imaging_requests
--     drop column imaging_status, drop column priority, drop column appointment_id,
--     drop column referring_provider_id, drop column service_id;
-- ----------------------------------------------------------------------------