import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `setup` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/setup.
 */
export default async function LegacySetupPage() {
  redirect(await resolveTenantRedirect('/setup'));
}
