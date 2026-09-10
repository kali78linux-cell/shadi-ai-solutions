import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `analytics` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/analytics.
 */
export default async function LegacyAnalyticsPage() {
  redirect(await resolveTenantRedirect('/analytics'));
}