import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** POST /api/portal/auth/signout — end the patient portal session. */
export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
