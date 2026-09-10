import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `team` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/team.
 */
export default async function LegacyTeamPage() {
  redirect(await resolveTenantRedirect('/team'));
}