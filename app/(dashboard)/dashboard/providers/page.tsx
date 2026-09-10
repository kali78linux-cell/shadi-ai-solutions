import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `providers` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/providers.
 */
export default async function LegacyProvidersPage() {
  redirect(await resolveTenantRedirect('/providers'));
}