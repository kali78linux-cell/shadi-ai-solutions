import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSupabaseEnvConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

type MembershipRow = { clinic: { slug: string } | { slug: string }[] | null };

/**
 * TENANT-ISOLATED DASHBOARD — `/dashboard` entrypoint.
 *
 * Resolves the authenticated user's ACTIVE memberships server-side and routes:
 *   0 memberships → Arabic notice (no silent login loop),
 *   1 membership  → canonical `/dashboard/{clinicSlug}/overview`,
 *   many          → explicit `/dashboard/tenants` picker (never picks silently).
 *
 * The legacy English overview page is gone: flat module paths are compat
 * redirects to the canonical tenant routes, so the Arabic tenant dashboard is
 * the only dashboard a signed-in user can ever land on.
 */
export default async function DashboardIndexPage() {
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
  if (!user) redirect('/login?next=/dashboard');

  const { data: memberships } = await supabaseAdmin
    .from('clinic_users')
    .select('clinic:clinics(slug)')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  const slugs = ((memberships ?? []) as MembershipRow[])
    .map((m) => (Array.isArray(m.clinic) ? m.clinic[0]?.slug : m.clinic?.slug))
    .filter((s): s is string => Boolean(s));

  if (slugs.length === 0) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 text-center shadow-xl shadow-slate-950/30">
          <h1 className="text-xl font-semibold text-white">حسابك غير مرتبط بأي عيادة</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            تم تسجيل دخولك بنجاح، لكن لا توجد عضوية نشطة لحسابك في أي عيادة.
            تواصل مع مالك العيادة لإضافتك كعضو، أو أنشئ عيادة جديدة.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              إنشاء عيادة جديدة
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-slate-700 bg-slate-950/80 px-5 py-2 text-sm text-slate-200 transition hover:border-cyan-500/60"
            >
              تسجيل الدخول بحساب آخر
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (slugs.length === 1) {
    redirect(`/dashboard/${encodeURIComponent(slugs[0])}/overview`);
  }
  redirect('/dashboard/tenants');
}
