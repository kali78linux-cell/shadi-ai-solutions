'use client';

import { useClinicContext } from '@/lib/useClinicContext';

/**
 * Opens the LIVE clinic chat for the currently-selected dashboard clinic.
 *
 * ROOT-CAUSE FIX: the dashboard previously had NO path into /chat carrying the
 * clinic identity, so patients/staff hitting /chat saw "لم يتم تحديد العيادة"
 * even while working inside a specific clinic dashboard. The clinic id here
 * comes from the authenticated memberships resolved by useClinicContext
 * (server-verified on every API call) — never from a hand-typed value.
 */
export default function OpenClinicChatButton({ className }: { className?: string }) {
  const { clinicId, loading } = useClinicContext();

  // While memberships are resolving, or if the user truly has no clinic,
  // render nothing — the error case is handled inside /chat itself.
  if (loading || !clinicId) return null;

  return (
    <a
      href={`/chat?clinic=${encodeURIComponent(clinicId)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        'rounded-full border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-500/20'
      }
      title="يفتح محادثة العيادة المباشرة في تبويب جديد"
    >
      محادثة العيادة المباشرة ↗
    </a>
  );
}
