import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `patients` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/patients.
 */
export default async function LegacyPatientsPage() {
  redirect(await resolveTenantRedirect('/patients'));
}