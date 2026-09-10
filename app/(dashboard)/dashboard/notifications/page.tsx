import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `notifications` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/notifications.
 */
export default async function LegacyNotificationsPage() {
  redirect(await resolveTenantRedirect('/notifications'));
}