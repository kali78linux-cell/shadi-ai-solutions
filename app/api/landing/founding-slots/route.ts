import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { FOUNDING_SLOTS_TOTAL } from '@/lib/landing/landing-copy';

/**
 * GET /api/landing/founding-slots
 * Returns the number of founding-member places still available:
 *   remaining = FOUNDING_SLOTS_TOTAL - COUNT(*) WHERE is_founding_member = true
 *
 * The `is_founding_member` column is added by migration
 * db/migrations/20260821_founding_member_clinics.sql. Until that migration is
 * applied to the remote DB, the query errors (Supabase returns an error with an
 * empty message for a missing column). This endpoint is a PUBLIC counter and
 * must NEVER return 5xx — any error is treated as "migration not applied" and
 * falls back to FOUNDING_SLOTS_TOTAL (all places open). It exposes only the
 * public remaining count, never internal clinic data.
 */
export async function GET() {
  try {
    const { count, error } = await supabaseAdmin
      .from('clinics')
      .select('id', { count: 'exact', head: true })
      .eq('is_founding_member', true)
      .is('deleted_at', null);

    // Any error (missing column, network, RLS, etc.) → safe fallback.
    // Never expose the raw error to the client.
    if (error) {
      return NextResponse.json({ remaining: FOUNDING_SLOTS_TOTAL, total: FOUNDING_SLOTS_TOTAL, migrated: false });
    }

    const remaining = Math.max(0, FOUNDING_SLOTS_TOTAL - (count ?? 0));
    return NextResponse.json({ remaining, total: FOUNDING_SLOTS_TOTAL, migrated: true });
  } catch {
    // Defensive: never 5xx on a public counter.
    return NextResponse.json({ remaining: FOUNDING_SLOTS_TOTAL, total: FOUNDING_SLOTS_TOTAL, migrated: false });
  }
}