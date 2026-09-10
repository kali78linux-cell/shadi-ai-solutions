-- PRE-PRODUCTION HARDENING: additive-only performance indexes (safe at scale).
-- No data changes; IF NOT EXISTS keeps it idempotent and backward-compatible.
CREATE INDEX IF NOT EXISTS idx_services_clinic_id_active ON public.clinic_services(clinic_id, active) ;
CREATE INDEX IF NOT EXISTS idx_provider_services_clinic_service ON public.provider_services(clinic_id, service_id);
CREATE INDEX IF NOT EXISTS idx_messages_clinic_id ON public.messages(clinic_id);
CREATE INDEX IF NOT EXISTS idx_notifications_clinic_id_unread ON public.notifications(clinic_id);
