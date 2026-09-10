import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSupabaseEnvConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

type MembershipRow = {
  role: string;
  clinic: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
};

/**
 * TENANT-ISOLATED DASHBOARD — explicit multi-tenant picker.
 *
 * Rendered only when the authenticated user has MULTIPLE clinic memberships —
 * the tenant is NEVER chosen silently (first row). Every option is a canonical
 * `/dashboard/{clinicSlug}/overview` link; the server guard re-verifies the
 * membership on arrival, so the URL — not this list — is the source of truth.
 */
export default async function TenantsPickerPage() {
  if (!getSupabaseEnvConfig().isConfigured) {
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('slug')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return redirect(clinic?.slug ? `/dashboard/${clinic.slug}/overview` : '/login');
  }

  const serverClient = createSupabaseServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/tenants');

  const { data: memberships } = await supabaseAdmin
    .from('clinic_users')
    .select('role, clinic:clinics(id, name, slug)')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  const rows: { slug: string; name: string; role: string }[] = (memberships ?? [])
    .map((m: MembershipRow) => {
      const clinic = Array.isArray(m.clinic) ? m.clinic[0] : m.clinic;
      return clinic ? { slug: clinic.slug, name: clinic.name, role: m.role } : null;
    })
    .filter((x): x is { slug: string; name: string; role: string } => Boolean(x && x.slug));

  if (rows.length === 0) redirect('/login?next=/dashboard');
  if (rows.length === 1) return redirect(`/dashboard/${rows[0].slug}/overview`);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className="w-full max-w-md">
        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
          <h1 className="text-2xl font-semibold text-white">اختر العيادة</h1>
          <p className="mt-2 text-sm text-slate-400">
            أنت عضو في أكثر من عيادة. اختر لوحة التحكم التي تريد الدخول إليها.
          </p>
          <div className="mt-6 space-y-3">
            {rows.map((r) => (
              <Link
                key={r.slug}
                href={`/dashboard/${encodeURIComponent(r.slug)}/overview`}
                className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-950/60 px-5 py-4 transition hover:border-cyan-500/60 hover:bg-cyan-500/10"
              >
                <span className="font-semibold text-cyan-100">{r.name}</span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">{r.role}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}