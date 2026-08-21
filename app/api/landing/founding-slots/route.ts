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
 * applied to the remote DB, this endpoint falls back to FOUNDING_SLOTS_TOTAL
 * so the landing page still renders gracefully.
 */
export async function GET() {
  try {
    const { count, error } = await supabaseAdmin
      .from('clinics')
      .select('id', { count: 'exact', head: true })
      .eq('is_founding_member', true)
      .is('deleted_at', null);

    if (error) {
      // Column not present yet → migration not applied → treat as all open.
      if (error.message && /column|is_founding_member|syntax|does not exist/i.test(error.message)) {
        return NextResponse.json({ remaining: FOUNDING_SLOTS_TOTAL, total: FOUNDING_SLOTS_TOTAL, migrated: false });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const remaining = Math.max(0, FOUNDING_SLOTS_TOTAL - (count ?? 0));
    return NextResponse.json({ remaining, total: FOUNDING_SLOTS_TOTAL, migrated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ remaining: FOUNDING_SLOTS_TOTAL, total: FOUNDING_SLOTS_TOTAL, migrated: false });
  }
}