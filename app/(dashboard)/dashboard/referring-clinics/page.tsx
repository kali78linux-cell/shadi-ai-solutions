import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `referring-clinics` path (compat redirect). */
export default async function LegacyReferringClinicsPage() {
  redirect(await resolveTenantRedirect('/referring-clinics'));
}