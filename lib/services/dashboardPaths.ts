/**
 * Dashboard tenant path helpers — PURE (client-safe, no server imports).
 *
 * Canonical dashboard URL is `/dashboard/{clinicSlug}/{module}`. These helpers
 * validate a `?next=` value so login can never be an open redirect, and build
 * the canonical path from a module name. The tenant slug — not React state and
 * not a client-supplied clinic_id — is the source of truth for routing.
 */

const MODULE_SEGMENT = /^[a-z0-9-]+$/;
export const DASHBOARD_MODULES = [
  'overview', 'appointments', 'patients', 'providers', 'services',
  'conversations', 'leads', 'notifications', 'knowledge', 'knowledge-base',
  'ai-settings', 'communication-settings', 'clinic-setup', 'public-page',
  'ads', 'analytics', 'growth', 'financial-intelligence', 'imaging', 'lab',
  'subscription', 'team', 'setup', 'medical-files', 'messages', 'imaging-centers',
  // imaging-center workflow modules (activity-specific capabilities)
  'imaging-requests', 'referring-clinics',
  // PHASE L — public page content builder (theme/achievements/testimonials/articles/news)
  'public-content',
  // PHASE K — account self-service (profile + password change)
  'profile',
] as const;
export type DashboardModule = (typeof DASHBOARD_MODULES)[number];

/**
 * True when `path` is one of the safe internal dashboard destinations:
 *   /dashboard                      (legacy index)
 *   /dashboard/tenants              (multi-tenant picker)
 *   /dashboard/{clinicSlug}[/...]   (canonical tenant route)
 * Absolute URLs, protocol-relative URLs, `..`, backslashes and query-only
 * tricks are rejected.
 */
export function isSafeDashboardPath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (path.startsWith('//') || path.includes('\\') || path.includes('..') || path.includes(':')) {
    return false;
  }
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  if (segments[0] !== 'dashboard') return false;
  if (segments.length === 1) return true; // /dashboard
  if (segments.length === 2 && segments[1] === 'tenants') return true;
  // /dashboard/{clinicSlug}[/...] — every segment must be a safe token.
  return segments.slice(1).every((s) => MODULE_SEGMENT.test(s));
}

/** `/dashboard/{clinicSlug}/{module}` — canonical tenant-scoped URL. */
export function tenantDashboardUrl(clinicSlug: string, module: DashboardModule | string): string {
  return `/dashboard/${encodeURIComponent(clinicSlug)}/${module}`;
}

/** `/login?next=/dashboard/{clinicSlug}/overview` — public-space owner entry. */
export function ownerLoginUrl(clinicSlug: string): string {
  return `/login?next=${encodeURIComponent(tenantDashboardUrl(clinicSlug, 'overview'))}`;
}