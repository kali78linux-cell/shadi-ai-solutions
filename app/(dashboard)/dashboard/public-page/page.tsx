import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `public-page` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/public-page.
 */
export default async function LegacyPublicPagePage() {
  redirect(await resolveTenantRedirect('/public-page'));
}
