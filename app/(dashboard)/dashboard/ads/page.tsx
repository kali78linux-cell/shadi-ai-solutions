import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `ads` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/ads.
 */
export default async function LegacyAdsPage() {
  redirect(await resolveTenantRedirect('/ads'));
}