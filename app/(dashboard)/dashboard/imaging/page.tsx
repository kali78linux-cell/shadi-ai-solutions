import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `imaging` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/imaging.
 */
export default async function LegacyImagingPage() {
  redirect(await resolveTenantRedirect('/imaging'));
}
