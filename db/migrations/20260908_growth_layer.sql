-- ============================================================================
-- GROWTH LAYER FOUNDATION - RECALL / NO-SHOW RECOVERY / WAITLIST
-- (D-G1, D-G2, D-G3 - owner-approved)
-- Additive only. Reuses notification_queue / clinic_notification_templates.
-- No new ledger kinds (not a financial phase). No workers/cron.
-- ============================================================================

-- 0) Composite tenant key for providers (needed for tenant-safe FKs below)
create unique index if not exists providers_clinic_id_id_key
  on public.providers (clinic_id, id);

-- 1) clinic_recall_rules - per-service rule with clinic-wide fallback (D-G1)
create table if not exists public.clinic_recall_rules (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics (id) on delete cascade,
  service_id       uuid,
  recall_after_days integer not null check (recall_after_days between 1 and 3650),
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fk_recall_rule_service
    foreign key (clinic_id, service_id)
    references public.clinic_services (clinic_id, id) on delete cascade
);

create unique index if not exists uq_recall_rules_clinic_fallback
  on public.clinic_recall_rules (clinic_id)
  where service_id is null;
create unique index if not exists uq_recall_rules_clinic_service
  on public.clinic_recall_rules (clinic_id, service_id)
  where service_id is not null;

-- 2) clinic_recalls (D-G1)
create table if not exists public.clinic_recalls (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics (id) on delete cascade,
  patient_id    uuid not null,
  service_id    uuid,
  due_at        date not null,
  status        text not null default 'open'
                check (status in ('open', 'notified', 'scheduled', 'dismissed')),
  linked_appointment_id uuid,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint fk_recall_patient
    foreign key (clinic_id, patient_id)
    references public.patients (clinic_id, id) on delete cascade,
  constraint fk_recall_linked_appointment
    foreign key (clinic_id, linked_appointment_id)
    references public.appointments (clinic_id, id) on delete set null
);

create unique index if not exists uq_recalls_active_period
  on public.clinic_recalls (
    clinic_id, patient_id,
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    due_at
  )
  where status in ('open', 'notified');

create index if not exists idx_recalls_clinic_status_due
  on public.clinic_recalls (clinic_id, status, due_at);

-- 3) clinic_waitlist_entries (D-G3)
create table if not exists public.clinic_waitlist_entries (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics (id) on delete cascade,
  patient_id      uuid not null,
  provider_id     uuid,
  service_id      uuid,
  preferred_from  time,
  preferred_to    time,
  priority        integer not null default 0 check (priority between 0 and 100),
  expires_at      timestamptz not null,
  status          text not null default 'active'
                  check (status in ('active', 'notified', 'booked', 'expired', 'cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fk_waitlist_patient
    foreign key (clinic_id, patient_id)
    references public.patients (clinic_id, id) on delete cascade,
  constraint fk_waitlist_provider
    foreign key (clinic_id, provider_id)
    references public.providers (clinic_id, id) on delete set null,
  constraint fk_waitlist_service
    foreign key (clinic_id, service_id)
    references public.clinic_services (clinic_id, id) on delete set null
);

create index if not exists idx_waitlist_match
  on public.clinic_waitlist_entries (clinic_id, status, priority desc);

-- 4) notification_queue idempotency for growth events (DB-level)
create unique index if not exists uq_nq_no_show_recovery
  on public.notification_queue (clinic_id, appointment_id)
  where type = 'no_show_recovery' and appointment_id is not null;

create unique index if not exists uq_nq_recall_once
  on public.notification_queue (clinic_id, (payload->>'recall_id'))
  where type = 'recall' and (payload->>'recall_id') is not null;

create unique index if not exists uq_nq_waitlist_offer_once
  on public.notification_queue (clinic_id, appointment_id)
  where type = 'waitlist_offer' and appointment_id is not null;

-- 5) Extend clinic_notification_templates allowed types (additive)
alter table public.clinic_notification_templates
  drop constraint if exists clinic_notification_templates_template_type_check;

alter table public.clinic_notification_templates
  add constraint clinic_notification_templates_template_type_check
  check (template_type in (
    'appointment_confirmation',
    'appointment_reminder',
    'appointment_cancellation',
    'appointment_rescheduling',
    'recall',
    'no_show_recovery',
    'waitlist_offer'
  ));

-- 6) Default Arabic templates for the three new types (additive)
insert into public.clinic_notification_templates
  (clinic_id, template_type, channel, language, subject, body)
select c.id, t.template_type, t.channel, 'ar' as language, t.subject, t.body
from public.clinics c
cross join (
  values
    ('recall', 'email', 'استدعاء مريض - {{clinic_name}}', 'عزيزي/عزيزتي {{patient_name}}،\n\nنذكركم بموعد المتابعة في عيادة {{clinic_name}}.\n\nالخدمة: {{service_name}}\nالتاريخ المقترح: {{recall_date}}\n\nللحجز: {{booking_link}}\n\nصحة وعافية.'),
    ('recall', 'whatsapp', 'استدعاء مريض - {{clinic_name}}', 'عزيزي/عزيزتي {{patient_name}}،\n\nنذكركم بموعد المتابعة في عيادة {{clinic_name}}.\n\nالخدمة: {{service_name}}\nالتاريخ المقترح: {{recall_date}}\n\nللحجز: {{booking_link}}\n\nصحة وعافية.'),
    ('no_show_recovery', 'email', 'متابعة موعد فائت - {{clinic_name}}', 'عزيزي/عزيزتي {{patient_name}}،\n\nلاحظنا عدم حضورك لموعدك في عيادة {{clinic_name}}.\n\nيمكنك إعادة جدولته بسهولة من الرابط:\n{{reschedule_link}}\n\nمع أطيب التمنيات.'),
    ('no_show_recovery', 'whatsapp', 'متابعة موعد فائت - {{clinic_name}}', 'عزيزي/عزيزتي {{patient_name}}،\n\nلاحظنا عدم حضورك لموعدك في عيادة {{clinic_name}}.\n\nيمكنك إعادة جدولته بسهولة من الرابط:\n{{reschedule_link}}\n\nمع أطيب التمنيات.'),
    ('waitlist_offer', 'email', 'توفّر موعد - {{clinic_name}}', 'عزيزي/عزيزتي {{patient_name}}،\n\nأصبح موعد متاحًا في عيادة {{clinic_name}}.\n\nالتاريخ: {{appointment_date}}\nالوقت: {{appointment_time}}\n\nللحجز: {{booking_link}}\n\nنتشرف بكم.'),
    ('waitlist_offer', 'whatsapp', 'توفّر موعد - {{clinic_name}}', 'عزيزي/عزيزتي {{patient_name}}،\n\nأصبح موعد متاحًا في عيادة {{clinic_name}}.\n\nالتاريخ: {{appointment_date}}\nالوقت: {{appointment_time}}\n\nللحجز: {{booking_link}}\n\nنتشرف بكم.')
) as t(template_type, channel, subject, body)
where not exists (
  select 1 from public.clinic_notification_templates ex
  where ex.clinic_id = c.id and ex.template_type = t.template_type
    and ex.channel = t.channel and ex.language = 'ar'
);

-- 7) RLS - default-deny, consistent with financial phases; all access is
--    server-side via supabaseAdmin after authorizeClinicRequest.
alter table public.clinic_recall_rules enable row level security;
alter table public.clinic_recalls enable row level security;
alter table public.clinic_waitlist_entries enable row level security;
