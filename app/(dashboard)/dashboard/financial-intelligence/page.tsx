import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `financial-intelligence` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/financial-intelligence.
 */
export default async function LegacyFinancialIntelligencePage() {
  redirect(await resolveTenantRedirect('/financial-intelligence'));
}
