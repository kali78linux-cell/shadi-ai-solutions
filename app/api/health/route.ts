import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe for uptime monitoring (no secrets, no PII).
 * Checks DB connectivity with a trivial query and reports component status.
 */
export async function GET() {
  const started = Date.now();
  let db = 'ok';
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { error } = await supabaseAdmin.from('clinics').select('id', { count: 'exact', head: true }).limit(1);
    if (error) db = 'degraded';
  } catch {
    db = 'down';
  }
  const stripe = process.env.STRIPE_SECRET_KEY ? 'configured' : 'unconfigured';
  const status = db === 'ok' ? 200 : 503;
  return NextResponse.json(
    { status: db === 'ok' ? 'healthy' : 'unhealthy', components: { db, stripe }, latency_ms: Date.now() - started, timestamp: new Date().toISOString() },
    { status }
  );
}
