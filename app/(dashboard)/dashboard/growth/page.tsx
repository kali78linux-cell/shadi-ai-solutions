import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `growth` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/growth.
 */
export default async function LegacyGrowthPage() {
  redirect(await resolveTenantRedirect('/growth'));
}
