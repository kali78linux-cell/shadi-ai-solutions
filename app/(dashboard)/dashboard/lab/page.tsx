import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `lab` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/lab.
 */
export default async function LegacyLabPage() {
  redirect(await resolveTenantRedirect('/lab'));
}
