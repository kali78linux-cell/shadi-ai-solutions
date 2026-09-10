-- PP-8A — Provider Visibility Foundation (docs/pp8-product-ux-spec.md §10.2 / §20)
-- Additive, default-safe visibility state for providers.
--
-- 'private' is the deny-by-default default: NO existing (or future) provider
-- becomes publicly visible or discoverable by this migration.
-- Discovery eligibility is additionally gated by
-- clinics.settings.public_profile.discovery_enabled (JSONB — no migration
-- needed; consumed by later PP-8 phases only).
--
-- No RLS/policy changes: providers keeps its existing member policies; the
-- service-role path is reached only through authorized clinic APIs
-- (authorizeClinicRequest + ADMIN_ROLES). No public read of this column
-- exists in PP-8A. Zero impact on 15D behavior (/c/[slug] ·
-- clinicPublicProfile · resolvePublicClinic · /book · /chat).
--
-- Rollback: alter table public.providers drop column if exists public_visibility;

alter table public.providers
  add column if not exists public_visibility text
  not null default 'private'
  check (public_visibility in ('private', 'noindex', 'indexable'));
