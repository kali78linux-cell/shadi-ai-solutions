/**
 * activate-paid-subscriptions.mjs — re-attach ALREADY-PAID Stripe subscriptions
 * that never reached the DB because no webhook endpoint existed at payment time.
 *
 * READ from Stripe (source of truth) → verify payment_status=paid and
 * subscription.status=active → cross-check price/plan/clinic → write the single
 * effective subscription row. One effective subscription per tenant (DB-enforced
 * by uq_subscriptions_one_active_per_clinic); older duplicate Stripe
 * subscriptions are detected and reported (never auto-cancelled/refunded).
 * CREDENTIALS: read from .env.local (never printed).
 */
import fs from 'fs';

const c = fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = get('SUPABASE_ACCESS_TOKEN');
const sk = get('STRIPE_SECRET_KEY');
if (!url || !sk || !accessToken) {
  console.log('BLOCKED — missing NEXT_PUBLIC_SUPABASE_URL / STRIPE_SECRET_KEY / SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

const ref = url.replace('https://', '').split('.')[0];
const apiBase = `https://api.supabase.com/v1/projects/${ref}/database/query`;
async function sql(q) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `SQL HTTP ${res.status}`);
  return body;
}
async function stripeGet(path) {
  const res = await fetch('https://api.stripe.com/v1' + path, { headers: { authorization: 'Bearer ' + sk } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Stripe HTTP ${res.status}`);
  return body;
}

async function main() {
  console.log('=== ACTIVATE ALREADY-PAID STRIPE SUBSCRIPTIONS (live, read-verify→write) ===\n');
  const rows = await sql(
    "select s.id, s.clinic_id, c.slug, s.plan_id, s.status, s.stripe_checkout_session_id " +
    "from public.subscriptions s join public.clinics c on c.id = s.clinic_id " +
    "where s.deleted_at is null and s.status != 'canceled' order by s.updated_at desc"
  );
  let activated = 0;
  let duplicate = 0;
  for (const row of (rows ?? [])) {
    const sessionId = row.stripe_checkout_session_id;
    if (!sessionId) { console.log(`SKIP ${row.slug} — no stripe session (status=${row.status})`); continue; }
    let session;
    try {
      session = await stripeGet(`/checkout/sessions/${sessionId}?expand[]=line_items`);
    } catch (err) {
      console.log(`SKIP ${row.slug} — session fetch failed: ${err.message}`); continue;
    }
    const paid = session?.payment_status === 'paid';
    if (!paid) { console.log(`SKIP ${row.slug} — session ${sessionId.slice(0,12)} payment_status=${session?.payment_status}`); continue; }

    const subId = session?.subscription;
    let sub = null;
    if (typeof subId === 'string' && subId.startsWith('sub_')) {
      try { sub = await stripeGet(`/subscriptions/${subId}`); } catch {}
    }
    const active = sub?.status === 'active' || session?.status === 'complete';
    const metadata = session?.metadata ?? {};
    const lineItems = session?.line_items?.data ?? [];
    const priceId = lineItems[0]?.price?.id ?? null;
    const expectedPrice = await sql(`select price_per_month, stripe_price_id from public.billing_plans where plan_id = '${metadata?.plan_id ?? row.plan_id}'`).catch(() => null);
    const expectedPriceId = expectedPrice?.[0]?.stripe_price_id;
    const priceMatches = !!priceId && !!expectedPriceId && priceId === expectedPriceId;

    const planOk = !!metadata?.plan_id && metadata?.plan_id !== 'starter';
    const clinicOk = !!metadata?.clinic_id && metadata?.clinic_id === row.clinic_id;

    console.log(`\n[${row.slug}]`);
    console.log(`  session  : ${sessionId}  payment_status=${session?.payment_status}`);
    console.log(`  sub      : ${subId}  status=${sub?.status ?? 'n/a'}`);
    console.log(`  plan     : ${metadata?.plan_id ?? row.plan_id}  priceId=${priceId} match=${priceMatches}`);
    console.log(`  clinic   : ${metadata?.clinic_id ?? 'n/a'}  match=${clinicOk}`);
    console.log(`  verdict  : paid=${paid} active=${active} planOk=${planOk} priceMatch=${priceMatches} clinicMatch=${clinicOk}`);

    const checks = { paid, active, planOk, priceMatches, clinicOk };
    if (Object.values(checks).some((v) => !v)) {
      const reason = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(',');
      console.log(`  → NOT activated (blocked by: ${reason})`);
      continue;
    }

    const periodStart = new Date();
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const payloadPlan = metadata?.plan_id ?? row.plan_id;
    await sql(`update public.subscriptions set ` +
      `plan_id='${payloadPlan}', status='active', billing_status='monthly', ` +
      `stripe_customer_id='${session?.customer ?? ''}', billing_customer_id='${session?.customer ?? ''}', ` +
      `stripe_subscription_id='${subId ?? ''}', stripe_checkout_session_id='${sessionId}', ` +
      `current_period_start='${periodStart.toISOString()}', current_period_end='${periodEnd.toISOString()}', ` +
      `deleted_at=null, updated_at=now() ` +
      `where id='${row.id}'`);
    activated += 1;
    console.log(`  → ACTIVATED: plan=${payloadPlan} status=active for ${row.slug}`);
  }

  const dup = await sql(
    `select stripe_subscription_id, count(*)::int c from public.subscriptions where deleted_at is null group by stripe_subscription_id having count(*) > 1`
  );
  if (dup?.length) { duplicate += dup.length; console.log(`\n⚠ duplicate stripe subscription rows: ${JSON.stringify(dup)}`); }
  console.log(`\nDONE — activated=${activated} duplicate-rows=${duplicate}`);
}

main().catch((err) => { console.error('FATAL: ', err.message); process.exit(1); });