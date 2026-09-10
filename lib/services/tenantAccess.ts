import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSupabaseEnvConfig } from '@/lib/config';
import { isSafeDashboardPath } from '@/lib/services/dashboardPaths';

/**
 * TENANT-ISOLATED DASHBOARD — server-side tenant resolution.
 *
 * Source of truth: `clinicSlug` from the URL. The server:
 *   1. authenticates the current user (cookies → Supabase Auth),
 *   2. resolves the clinic row by slug,
 *   3. checks an ACTIVE `clinic_users` membership for (user, clinic),
 *   4. grants access with the role only when the membership exists.
 *
 * RLS / `authorizeClinicRequest` / `app_user_is_active_clinic_member` are
 * untouched — this guard sits in front of the dashboard layout and every
 * nested module page. No client-provided clinic_id is ever trusted here.
 */

export type TenantAccessResult =
  | { ok: true; status: 200; clinicId: string; clinic: { id: string; slug: string; name: string }; role: string }
  | { ok: false; status: 401 | 403 | 404; clinic?: { id: string; slug: string; name: string } };

export async function resolveTenantAccess(clinicSlug: string): Promise<TenantAccessResult> {
  const slug = String(clinicSlug ?? '').trim().toLowerCase();
  if (!slug) return { ok: false, status: 404 };

  // Local demo mode (no Supabase env): allow tenant access so the dev flow keeps
  // working exactly like the previous client-only demo session. Production is
  // always configured, so this branch never weakens real auth.
  if (!getSupabaseEnvConfig().isConfigured) {
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('id, slug, name')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();
    if (!clinic) return { ok: false, status: 404 };
    return { ok: true, status: 200, clinicId: clinic.id, clinic, role: 'owner' };
  }

  // 1. Authenticate.
  const serverClient = createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await serverClient.auth.getUser();
  if (authError || !user) return { ok: false, status: 401 };

  // 2. Resolve the clinic by slug.
  const { data: clinic, error: clinicError } = await supabaseAdmin
    .from('clinics')
    .select('id, slug, name')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (clinicError || !clinic) return { ok: false, status: 404 };

  // 3+4. Active membership for (user, clinic).
  const { data: member, error: memberError } = await supabaseAdmin
    .from('clinic_users')
    .select('role')
    .eq('clinic_id', clinic.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (memberError || !member) return { ok: false, status: 403, clinic };

  return { ok: true, status: 200, clinicId: clinic.id, clinic, role: member.role };
}

/**
 * For legacy flat dashboard paths (`/dashboard/{module}`).
 * Returns the canonical tenant path, the multi-tenant picker, or a safe login
 * path — based on the authenticated user's memberships. Never picks a tenant
 * arbitrarily when the user has multiple memberships.
 */
export async function resolveTenantRedirect(modulePath: string): Promise<string> {
  const safeLegacy = `/dashboard${modulePath}`;

  if (!getSupabaseEnvConfig().isConfigured) {
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('slug')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return clinic?.slug ? `/dashboard/${clinic.slug}${modulePath}` : `/login?next=${encodeURIComponent(safeLegacy)}`;
  }

  const serverClient = createSupabaseServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) return `/login?next=${encodeURIComponent(safeLegacy)}`;

  const { data: memberships } = await supabaseAdmin
    .from('clinic_users')
    .select('clinic:clinics(slug)')
    .eq('user_id', user.id)
    .is('deleted_at', null);
  const slugs = (memberships ?? [])
    .map((m) => (Array.isArray(m.clinic) ? m.clinic[0]?.slug : (m.clinic as { slug?: string } | null)?.slug))
    .filter((s): s is string => Boolean(s));

  if (slugs.length === 0) return `/login?next=${encodeURIComponent(safeLegacy)}`;
  if (slugs.length === 1) return `/dashboard/${slugs[0]}${modulePath}`;
  return `/dashboard/tenants?next=${encodeURIComponent(safeLegacy)}`;
}

/** Guard for login `?next=` — safe dashboard paths only. */
export { isSafeDashboardPath };