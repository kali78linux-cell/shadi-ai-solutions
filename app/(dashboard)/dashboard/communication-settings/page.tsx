import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `communication-settings` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/communication-settings.
 */
export default async function LegacyCommunicationSettingsPage() {
  redirect(await resolveTenantRedirect('/communication-settings'));
}