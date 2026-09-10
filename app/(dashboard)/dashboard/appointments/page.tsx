import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `appointments` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/appointments.
 */
export default async function LegacyAppointmentsPage() {
  redirect(await resolveTenantRedirect('/appointments'));
}