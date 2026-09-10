-- Booking integrity: preserve catalog/conversation linkage and make the
-- availability check race-safe at the database boundary.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.clinic_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_service_id
  ON public.appointments(clinic_id, service_id);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_conversation_id
  ON public.appointments(clinic_id, conversation_id);

-- Tentative appointments reserve a slot too. Cancelled/completed/no-show rows
-- do not prevent a future booking at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_provider_slot_unique
  ON public.appointments(provider_id, scheduled_at)
  WHERE deleted_at IS NULL
    AND provider_id IS NOT NULL
    AND scheduled_at IS NOT NULL
    AND status IN ('tentative', 'scheduled', 'confirmed');
