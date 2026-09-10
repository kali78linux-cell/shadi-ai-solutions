-- ============================================================================
-- PHASE A — IMAGING DOMAIN + CANONICAL BOOKING (2026-09-07)
-- Non-destructive: only ADD COLUMN + UPSERT domain catalog for imaging centers.
-- Does NOT touch patients / appointments / payments / RLS / subscriptions.
-- ============================================================================

-- 1) Extend imaging_services with the specialized imaging domain model.
ALTER TABLE public.imaging_services
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS price_min numeric,
  ADD COLUMN IF NOT EXISTS price_max numeric,
  ADD COLUMN IF NOT EXISTS price_note text,
  ADD COLUMN IF NOT EXISTS requires_provider boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preparation_instructions text,
  ADD COLUMN IF NOT EXISTS report_policy text,
  ADD COLUMN IF NOT EXISTS delivery_methods jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- One row per (clinic, imaging service) — prevents duplicate catalog rows.
CREATE UNIQUE INDEX IF NOT EXISTS imaging_services_clinic_id_name_key
  ON public.imaging_services (clinic_id, name);
--    authoritative clinic_services rows. No fake numbers invented.
INSERT INTO public.imaging_services
  (clinic_id, name, modality, description, duration_minutes, price, active,
   pricing_mode, price_min, price_max, price_note, requires_provider,
   preparation_instructions, report_policy, delivery_methods, sort_order)
SELECT
  cs.clinic_id,
  cs.name,
  CASE WHEN cs.name LIKE '%بانوراما%' THEN 'panoramic'
       WHEN lower(cs.name) LIKE '%cbct%' OR cs.name LIKE '%طبقي%' THEN 'cbct'
       WHEN cs.name LIKE '%مقطع%' THEN 'sections'
       ELSE NULL END AS modality,
  cs.description,
  cs.duration_minutes,
  CASE WHEN cs.pricing_type = 'fixed' THEN cs.price ELSE NULL END AS price,
  cs.active,
  coalesce(cs.pricing_type, 'unspecified') AS pricing_mode,
  CASE WHEN cs.price_min IS NOT NULL AND cs.price_min > 0 THEN cs.price_min ELSE NULL END,
  CASE WHEN cs.price_max IS NOT NULL AND cs.price_max > 0 THEN cs.price_max ELSE NULL END,
  NULL,
  false,
  NULL,
  NULL,
  '[]'::jsonb,
  row_number() OVER (PARTITION BY cs.clinic_id ORDER BY cs.name)
FROM public.clinic_services cs
JOIN public.clinics c ON c.id = cs.clinic_id AND c.activity_type = 'imaging_center'
WHERE cs.active = true AND cs.deleted_at IS NULL
ON CONFLICT (clinic_id, name) DO NOTHING;

-- ============================================================================
-- 3) GENERAL provider-optionality (not an imaging-specific hack): add the flag to
--    the canonical booking source (clinic_services) and mirror the imaging domain
--    decision by name so /book + AI + availability all agree on whether a
--    provider is required for each service.
-- ============================================================================
ALTER TABLE public.clinic_services
  ADD COLUMN IF NOT EXISTS requires_provider boolean NOT NULL DEFAULT false;

UPDATE public.clinic_services cs
SET requires_provider = COALESCE(img.requires_provider, false)
FROM public.imaging_services img
WHERE img.clinic_id = cs.clinic_id
  AND img.name = cs.name
  AND cs.deleted_at IS NULL;
