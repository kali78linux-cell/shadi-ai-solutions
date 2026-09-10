import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `leads` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/leads.
 */
export default async function LegacyLeadsPage() {
  redirect(await resolveTenantRedirect('/leads'));
}