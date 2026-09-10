import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `public-content` path (compat redirect) — PHASE L content builder. */
export default async function LegacyPublicContentPage() {
  redirect(await resolveTenantRedirect('/public-content'));
}
