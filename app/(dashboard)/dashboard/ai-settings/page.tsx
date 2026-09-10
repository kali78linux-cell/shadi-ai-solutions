import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `ai-settings` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/ai-settings.
 */
export default async function LegacyAiSettingsPage() {
  redirect(await resolveTenantRedirect('/ai-settings'));
}