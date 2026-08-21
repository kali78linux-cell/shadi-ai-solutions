# Project Status

_This file is being updated as part of the Clinic Registration & Authentication Verification task and the AI-Receptions Landing Page build._

## Clinic Registration & Authentication Verification

**Status: COMPLETE — Verified against real Supabase**

### Root cause

The registration → login → dashboard authentication flow was broken because the
**register page originally used client-side `supabase.auth.signUp()`**, but the remote
Supabase project has **email confirmation ENABLED**. An unconfirmed `signUp()` returns
**NO session** (and NO `access_token`), which caused the register page to abort before
the server route was ever reached. The result was an auth account with **NO clinic,
NO `clinic_users` membership, and NO dashboard access** — a half-registered account.

### Exact fix

Registration now happens **server-side** in `app/api/auth/register/route.ts` using the
service-role `supabaseAdmin` client:

1. Creates the auth user with `email_confirm: true` → login works immediately regardless
   of the project's email-confirmation setting.
2. Creates the `clinics` row.
3. Creates the `clinic_users` owner membership.
4. On any failure, **rolls back** by deleting the created auth user so no orphaned
   account remains.

The register page calls this route via `fetch('/api/auth/register')` and redirects to
`/login?registered=1` on success, so the user signs in with a fresh, real session.
No RLS was disabled and no clinic IDs are hardcoded.

### Files changed

- `app/api/auth/register/route.ts` — server-side registration (already fixed before this audit; verified correct).
- `app/(auth)/register/page.tsx` — calls `/api/auth/register`, no longer aborts on unsaved session (verified correct).
- `app/(auth)/login/page.tsx` — `signInWithPassword` then redirect to `/dashboard` (verified correct).
- `components/auth/DashboardAuthGuard.tsx` — session check, redirects unauthenticated to `/login` (verified correct).
- `lib/useClinicContext.ts` — resolves clinic from session → `clinic_users` → clinic (verified correct).
- `lib/supabase.ts` — browser anon client with `persistSession: true` (verified correct).
- `app/layout.tsx` — **FIXED BUILD BREAK**: removed import/usage of non-existent `ToastProvider` from `@/components/ui/Toast`; `Toast.tsx` exports `useToast`/`ToastContainer`/`toast` only, no provider component. This was blocking `next build`.
- `db/migrations/20260816_fix_recursive_rls.sql` — SECURITY DEFINER helpers replace recursive RLS policies (verified present in repo).

### Test results

Ran against **real Supabase** via `scripts/verify-registration-flow.mjs`:

1. ✅ PASS — `auth.users` exists after registration
2. ✅ PASS — `clinics` row exists after registration
3. ✅ PASS — `clinic_users` owner membership exists
4. ✅ PASS — Relationship correct (clinic_id + user_id + role=owner)
5. ✅ PASS — Login after registration yields real session + access_token
6. ✅ PASS — Clinic resolution (same query as `useClinicContext`)
7. ✅ PASS — Refresh (new session) preserves clinic
8. ✅ PASS — Logout invalidates session (dashboard protected)
9. ✅ PASS — Wrong password rejected (`Invalid login credentials`)
10. ✅ PASS — Duplicate email rejected
11. ✅ PASS — Multi-tenant isolation (User A cannot access User B's clinic)
12. ✅ PASS — Server-side auth gate blocks cross-clinic access

**Result: 12 PASS / 0 FAIL**

Unit tests:
- ✅ PASS — `tests/unit/api-hardening.test.ts` — 5/5 tests (authorization gate rejects non-member clinic access)

Build:
- ✅ PASS — `npm run build` succeeds; `/login`, `/register`, `/dashboard`, `/dashboard/overview` all compiled

### Remaining issues

- ⚠️ PARTIAL — The `useToast`/`toast` convenience helpers are intact, but there is no global toast
  provider in the app shell; toast display relies on local state within `ads/page.tsx`. No functional
  impact on the auth flow.
- ⚠️ PARTIAL — `app/layout.tsx` shows a TS language-server warning for the `./globals.css`
  side-effect import; this is a known false positive — Next.js handles CSS imports natively
  and the build passes.
- ⚠️ PARTIAL — Manual browser click-through of the live UI was not executed; verification was done
  via the real Supabase API/database (service-role + anon clients) which exercises the exact same
  register/login/clinic-resolution queries the app uses.

---

## AI-Receptions Landing Page

**Status: COMPLETE (UI) — Migration PENDING application**

### What was built

A full Next.js landing page (`app/page.tsx` → `components/landing/`) matching the design spec:
- **Design system**: indigo `#4F46E5` / violet `#8B5CF6` / cyan `#22D3EE` / amber `#F5A623`,
  light bg `#F6F6FE`, dark `#0B0F2E`. Fonts: Tajawal (headings), IBM Plex Sans Arabic (body),
  IBM Plex Mono (numbers). Buttons: 14px rounded-square, gradient, hover lift + shadow.
- **Framer Motion** for fade-up, scroll-reveal, hover micro-interactions (installed `framer-motion@^11`).
- **Sections** (in order): Navbar (blur on scroll) → sticky UrgencyBar → Hero (animated phone chat
  mockup with the exact script) → Pain Stats → Features (5 cards incl. doctor hours) → For Doctors
  (10 numbered points with floating colored bubbles) → Gallery (SVG/emoji tiles, no real photos) →
  How It Works (3 steps, dashed connector) → Imaging (tabs: patient info / panorama / CT) → Pricing
  (founding $50 + standard $120 + live slots + 13-row features table) → Clinic Ads (carousel) →
  Compare (without/with AI) → FAQ (accordion) → LeadForm → Footer + FAB + mobile sticky CTA bar.

### Wired to real data

- ✅ **Founding-slots counter** — `GET /api/landing/founding-slots` returns
  `100 - COUNT(*) WHERE is_founding_member=true`. The UrgencyBar and Pricing section both fetch
  this live. **Graceful fallback**: if the migration isn't applied yet, returns `100` (all open).
- ✅ **Register route founding logic** — `app/api/auth/register/route.ts` now checks the founding
  count and sets `is_founding_member=true` + `founding_price_locked_at=now()` when slots remain.
  **Graceful fallback**: if the columns don't exist yet, it inserts without them so registration
  is never blocked.
- ✅ **Lead form** — `LeadForm` posts to `POST /api/leads` with `source='landing_page_founding_offer'`
  and `clinic_id=null` (pre-registration lead). Uses the existing `leads` table — no new table.

### Placeholder / PENDING

- ⚠️ **Migration NOT applied** — `db/migrations/20260821_founding_member_clinics.sql` is committed
  but **not applied to the remote Supabase** because DDL (`ALTER TABLE`) requires a
  `SUPABASE_ACCESS_TOKEN` or DB password, neither of which is available. Until applied:
  - The founding-slot counter shows `100` (fallback) instead of the real remaining count.
  - The register route creates clinics as non-founding (fallback).
  - The lead form's `clinic_id=null` insert will fail (leads.clinic_id is still NOT NULL) until
    the migration makes it nullable.
- ⚠️ **Clinic ads** — carousel uses static placeholder content from `landing-copy.ts` with a
  `TODO` to connect to the `clinic_ads` table once live content exists.
- ⚠️ **Gallery** — uses emoji/SVG tiles, not real photos (per spec, to avoid copyright issues).
- ⚠️ **Hero chat** — currently a scripted animated mockup. Per spec, should be replaced with the
  real Anthropic-connected chat component (same as the clinic page) after the UI is done.
- ⚠️ **Pain stats numbers** — shown as general market claims with a footnote, not claimed as
  this clinic's own data.

### Test results

- ✅ PASS — `npm run build` succeeds; `/api/landing/founding-slots` and the landing page compile.
- ✅ PASS — `tests/unit/api-hardening.test.ts` 5/5 (auth/authorization gate unaffected).
- ⚠️ PARTIAL — `scripts/verify-registration-flow.mjs` was re-run after the register-route change;
  it was previously 12/12 PASS and the change only adds graceful fallback (no behavior change when
  the migration is absent).

### Files changed

- `db/migrations/20260821_founding_member_clinics.sql` (new, committed separately)
- `app/page.tsx` — now renders the landing page
- `app/layout.tsx` — Tajawal + IBM Plex fonts, RTL, updated metadata
- `tailwind.config.ts` — landing palette + fonts + shadows + keyframes
- `lib/landing/landing-copy.ts` (new) — single editable source of marketing copy/prices
- `components/landing/*` (new) — Navbar, UrgencyBar, Hero, Sections, LeadForm, LandingPage,
  LandingButton, motion helpers
- `app/api/landing/founding-slots/route.ts` (new)
- `app/api/auth/register/route.ts` — founding-member logic (graceful fallback)
- `package.json` / `package-lock.json` — added `framer-motion`

---

## Landing Page Production Readiness

**Status: AUDITED — 2 production blockers found**

### Verification matrix

| Feature | Expected | Actual | Evidence | Status |
|---|---|---|---|---|
| Landing page renders | HTTP 200, all sections | HTTP 200, 56KB, all key sections present | `curl /` → 200; grep found AI-Receptions, كل مكالمة, احجز مكانك, الدكتورة حلا, عرض التأسيس | ✅ VERIFIED |
| No console-breaking errors | No runtime errors | No 500s for `/`; "error" matches were Next.js error-boundary boilerplate | dev log: `GET / 200`; grep context showed `error-boundary.js`/`next-error-h1` | ✅ VERIFIED |
| No hydration errors | No hydration mismatch | ⚠️ Not verifiable without browser | No browser automation available | ⚠️ NOT VERIFIED |
| Responsive / RTL / mobile / desktop | Correct layout | ⚠️ Not verifiable without browser | No browser automation available | ⚠️ NOT VERIFIED |
| Founding-slots endpoint | Never 5xx, safe fallback | Returns 200 `{remaining:100,total:100,migrated:false}` | `curl /api/landing/founding-slots` → 200 | ✅ VERIFIED |
| Registration still works | 12/12 PASS | 12/12 PASS | `scripts/verify-registration-flow.mjs` | ✅ VERIFIED |
| Lead form (clinic_id=null) | Valid lead accepted | ❌ RLS blocks public insert → 500 | `POST /api/leads` → `new row violates row-level security policy` | ❌ FAILED |
| Lead form invalid input | Rejected cleanly | ❌ Also 500 (RLS) — no validation reached | `POST /api/leads {}` → 500 | ❌ FAILED |
| Hero chat simulation | Deterministic, no API calls | Deterministic scripted loop, no fetch, no keys | `components/landing/Hero.tsx` — pure setTimeout state machine | ✅ VERIFIED |
| No secrets in client bundle | No service-role key in frontend | Service-role only via `process.env`/`Deno.env.get`, never inlined | grep audit — all matches are env refs, values redacted | ✅ VERIFIED |
| `.env.local` gitignored | Not committed | Gitignored | `git check-ignore .env.local` → confirmed | ✅ VERIFIED |

### Founding-member system defensive audit

- **If `is_founding_member` doesn't exist**: `/api/landing/founding-slots` catches any error and returns the safe fallback (200, `remaining=100`). ✅
- **Does registration still work?** Yes — 12/12 PASS. The register route wraps the founding count in try/catch and falls back to a base insert if the column is missing. ✅
- **Does `/api/landing/founding-slots` fail safely?** Yes — fixed to never 5xx (was 500 before the fix). ✅
- **Does the landing page show a safe fallback?** Yes — UrgencyBar and Pricing default to `FOUNDING_SLOTS_TOTAL` (100) and only update on a successful fetch. ✅
- **Can a failed founding-slot query break registration?** No — the register route's founding check is wrapped in try/catch; a failure just leaves `is_founding_member=false`. ✅
- **Can a clinic receive founding status twice?** No — the flag is set once at insert time; there is no update path that re-grants it. ✅
- **Is the count race-safe?** ⚠️ PARTIAL — the register route does count-then-insert (not atomic). Under concurrent registrations near the 100-slot boundary, two clinics could both pass the `< 100` check. Acceptable for the current single-instance architecture, but not atomic. ⚠️ NOT VERIFIED as production-safe at scale.

### Production blockers

**1. Must fix before launch**
- ❌ **Lead form fails** — `POST /api/leads` with `clinic_id=null` is blocked by RLS (`new row violates row-level security policy`). The `createLead` service uses the anon/server client (RLS-enforced), but a public landing-page lead has no auth session and no clinic membership. Needs a server-side privileged insert path (e.g., service-role) or an RLS policy allowing anonymous `source='landing_page_founding_offer'` inserts with `clinic_id IS NULL`. This is the only functional blocker on the landing page.

**2. Requires external credentials**
- ⚠️ **Founding-member migration not applied** — `db/migrations/20260821_founding_member_clinics.sql` needs DDL access (SUPABASE_ACCESS_TOKEN or DB password). Until applied: counter shows 100 (fallback), clinics register as non-founding, and the lead `clinic_id=null` insert is blocked by the still-NOT-NULL column.

**3. Future integration**
- ⚠️ **Clinic advertisements** — static placeholder content; TODO to connect to `clinic_ads` table.
- ⚠️ **Hero AI chat** — scripted simulation; replace with real Anthropic-connected chat component.
- ⚠️ **Portfolio** — SVG/emoji tiles; replace with real photos when available.

**4. Cosmetic improvements**
- ⚠️ **Font loading** — dev log showed `fonts.gstatic.com` retries (network-dependent); fonts fall back gracefully to system fonts.
- ⚠️ **Browser visual verification** — not performed (no browser automation); recommend a manual click-through of all sections, RTL, and mobile/desktop before launch.
