import { notFound, redirect } from 'next/navigation';
import { resolveTenantAccess } from '@/lib/services/tenantAccess';
import { TenantProvider } from '@/lib/tenantContext';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — server guard for `/dashboard/{clinicSlug}/...`.
 *
 * resolveTenantAccess() authenticates the user, resolves the clinic by slug,
 * and verifies an ACTIVE clinic_users membership for (user, clinic). Only then
 * is the trusted tenant context provided to every nested module page. The URL
 * slug is the source of truth — no first-membership, no client clinic_id.
 */
export default async function TenantDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { clinicSlug: string };
}) {
  const result = await resolveTenantAccess(params.clinicSlug);

  if (result.status === 401) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(params.clinicSlug)}/overview`);
  }
  if (result.status === 404) {
    notFound();
  }
  if (!result.ok) {
    // Authenticated but not a member of this tenant → explicit 403, no data leak.
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
        <p className="text-lg font-bold text-red-200">لا تملك صلاحية الوصول إلى هذه العيادة.</p>
        <p className="mt-2 text-sm text-slate-300">
          يمكنك الوصول فقط إلى لوحات التحكم للعيادات التي أنت عضو فيها. سجّل الدخول بالحساب الصحيح ثم أعد المحاولة.
        </p>
        <a
          href="/dashboard"
          className="mt-4 inline-block rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          العودة إلى لوحة التحكم الخاصة بك
        </a>
      </div>
    );
  }

  return (
    <TenantProvider
      value={{
        clinicSlug: result.clinic.slug,
        clinicId: result.clinicId,
        clinicName: result.clinic.name,
        role: result.role,
      }}
    >
      {children}
    </TenantProvider>
  );
}