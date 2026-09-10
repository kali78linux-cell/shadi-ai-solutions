import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `profile` path (compat redirect) — PHASE K account self-service. */
export default async function LegacyProfilePage() {
  redirect(await resolveTenantRedirect('/profile'));
}
