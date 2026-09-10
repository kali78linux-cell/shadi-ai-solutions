import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `overview` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/overview. The old English overview
 * page (and its "Dashboard metrics unavailable" state) is retired — the tenant
 * overview is the single dashboard home.
 */
export default async function LegacyOverviewPage() {
  redirect(await resolveTenantRedirect('/overview'));
}