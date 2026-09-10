import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `messages` path (compat redirect). */
export default async function LegacyMessagesPage() {
  redirect(await resolveTenantRedirect('/messages'));
}