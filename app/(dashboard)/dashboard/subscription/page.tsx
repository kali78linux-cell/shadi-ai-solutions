import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `subscription` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/subscription.
 */
export default async function LegacySubscriptionPage() {
  redirect(await resolveTenantRedirect('/subscription'));
}