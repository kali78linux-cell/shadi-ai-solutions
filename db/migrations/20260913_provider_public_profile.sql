-- PP-8B-i — Provider Public Profile Data Foundation
-- (docs/pp8-product-ux-spec.md §8/§20 · owner-approved decisions 2026-09-02)
--
-- Additive nullable marketing fields for the future public doctor profile:
--   public_slug : opaque, stable, unique public identity for /d/{slug}
--                 (generated once by the service layer; NEVER derived from the
--                  internal uuid/user_id; stays reserved across
--                  deactivation/reactivation; NOT regenerated on rename)
--   specialty   : public marketing field (opt-in content, owner-managed)
--   bio         : professional bio (free text, owner-managed)
--   photo_url   : nullable URL string (V1 — same pattern as clinics.logo;
--                 no upload infrastructure in this phase)
--
-- Deny-by-default preserved: these columns are inert until PP-8B-ii builds
-- the public page; no public reader exists in PP-8B-i. RLS/policies unchanged.
--
-- Rollback: drop index + drop the four columns (data-only rollback).

alter table public.providers
  add column if not exists public_slug text,
  add column if not exists specialty text,
  add column if not exists bio text,
  add column if not exists photo_url text;

-- Unique public identity. Nullable columns allow multiple NULLs in Postgres,
-- so providers without a generated slug coexist safely.
create unique index if not exists providers_public_slug_key
  on public.providers (public_slug);

-- Defense-in-depth on the generated shape (service layer generates
-- 'dr-' + 12 lowercase hex chars; NULL allowed until first generation).
alter table public.providers
  add constraint providers_public_slug_shape
  check (public_slug is null or public_slug ~ '^dr-[a-z0-9]{8,32}$');
