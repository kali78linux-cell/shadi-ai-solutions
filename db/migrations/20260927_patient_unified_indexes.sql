-- ============================================================
-- PHASE I — Patient Unified File (performance indexes only)
-- SAFE: additive-only (CREATE INDEX IF NOT EXISTS), reversible.
-- No DDL changes to existing tables; only speeds up the new
-- unified patient page (files/invoices/payments/appointments).
-- ============================================================

-- medical_files: patient lookup (already indexed by clinic+patient? ensure patient)
CREATE INDEX IF NOT EXISTS idx_medical_files_patient_id_created
ON public.medical_files (patient_id, created_at DESC);

-- clinic_invoices: patient lookup (existing invoice_balances view already
-- filters by clinic_id + patient_id — ensure a fast path)
CREATE INDEX IF NOT EXISTS idx_invoices_patient_created
ON public.clinic_invoices (patient_id, created_at DESC);

-- clinic_payments: list by invoice then by patient (join path)
CREATE INDEX IF NOT EXISTS idx_payments_invoice_created
ON public.clinic_payments (invoice_id, created_at DESC);

-- appointments: patient timeline (already indexed by clinic)
CREATE INDEX IF NOT EXISTS idx_appointments_patient_scheduled
ON public.appointments (patient_id, scheduled_at DESC);

-- ============================================================
-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_medical_files_patient_id_created;
-- DROP INDEX IF EXISTS idx_invoices_patient_created;
-- DROP INDEX IF EXISTS idx_payments_invoice_created;
-- DROP INDEX IF EXISTS idx_appointments_patient_scheduled;
-- ============================================================