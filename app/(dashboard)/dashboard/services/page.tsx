import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `services` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/services.
 */
export default async function LegacyServicesPage() {
  redirect(await resolveTenantRedirect('/services'));
}