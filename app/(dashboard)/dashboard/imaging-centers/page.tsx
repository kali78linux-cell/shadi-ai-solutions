import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `imaging-centers` path (compat redirect). */
export default async function LegacyImagingCentersPage() {
  redirect(await resolveTenantRedirect('/imaging-centers'));
}