-- Real-clinic blocker fix: patients.email was NOT NULL while a unique index
-- exists on (clinic_id, lower(email)). Combined, a clinic could only ever have
-- ONE patient without an email — the second phone-only booking failed with 500.
-- Making email nullable lets Postgres treat missing emails as distinct (default
-- unique-index NULL semantics). No data changes; purely additive safety.
ALTER TABLE public.patients ALTER COLUMN email DROP NOT NULL;
