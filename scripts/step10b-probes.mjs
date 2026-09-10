// STEP 10B supplementary probes — shadi-nouri (X) + demo-dental-clinic (Y, READ-ONLY).
// Covers: multi-turn context persistence, understanding, handoff, tenant isolation.
// Cleanup: ONLY rows created by this probe (IDs captured at creation).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = env.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const X_SLUG = 'shadi-nouri';
const Y_SLUG = 'demo-dental-clinic';
const MARK = `STEP10B-${Date.now()}`;
const SYNTH_NAME = `أحمد تجريبي ${MARK}`;
const convs = []; // conversation ids created by this probe (all under X)

async function send(slug, text, conversation_id) {
  const r = await fetch(`${BASE}/api/public/ai/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ clinic_slug: slug, text, conversation_id }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function hist(slug, convId) {
  const r = await fetch(`${BASE}/api/public/ai/messages?conversation_id=${convId}&clinic_slug=${slug}`, { cache: 'no-store' });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function cleanup() {
  for (const cid of convs) {
    await admin.from('messages').delete().eq('conversation_id', cid);
    await admin.from('conversations').delete().eq('id', cid);
  }
  const chk = await admin.from('conversations').select('id').in('id', convs);
  console.log('CLEANUP remaining_conv_rows=' + (chk.data?.length ?? 'ERR') + ' (expected 0)');
}

(async () => {
try {
  // ---- SC-1: multi-turn context persistence (X) ----
  const m1 = await send(X_SLUG, `مرحبا، اسمي ${SYNTH_NAME}. أريد استشارة بسيطة.`);
  const conv = m1.body?.conversation_id;
  convs.push(conv);
  console.log('SC1_MSG1 status=' + m1.status + ' conv=' + conv);
  await new Promise(r => setTimeout(r, 1000));
  const m2 = await send(X_SLUG, 'ما هو اسمي الذي ذكرته لك؟', conv);
  const reply = m2.body?.assistant_message?.content ?? "";
  console.log('SC1_MSG2 status=' + m2.status + ' reply_contains_name=' + String(reply).includes(SYNTH_NAME));
  console.log('SC1_MSG2 snippet=' + String(reply).slice(0, 160).replace(/\n/g, ' '));
  const h = await hist(X_SLUG, conv);
  console.log('SC1_HISTORY status=' + h.status + ' msgCount=' + (h.body?.messages?.length ?? h.body?.data?.length ?? 0) + ' roles=' + JSON.stringify((h.body?.messages ?? h.body?.data ?? []).map(m => m.role)));

  // ---- SC-2: handoff (X) ----
  const m3 = await send(X_SLUG, 'عندي ألم شديد جداً وانتفاخ في الوجه وصعوبة في البلع، ماذا أفعل؟');
  const c3 = m3.body?.conversation_id;
  convs.push(c3);
  const bctx3 = m3.body?.booking_context;
  console.log('SC2_HANDOFF status=' + m3.status + ' conv=' + c3 + ' intent=' + (m3.body?.assistant_message?.metadata?.handoff ?? m3.body?.intent ?? 'n/a'));
  console.log('SC2_HANDOFF reply=' + String(m3.body?.assistant_message?.content ?? '').slice(0, 200).replace(/\n/g, ' '));
  console.log('SC2_NO_BOOKING_PUSH=' + ((bctx3?.recommended_service_id ?? null) === null));

  // ---- SC-3: tenant isolation (Y is READ-ONLY here) ----
  const asY = await hist(Y_SLUG, conv);            // Y tries to read X's conversation
  console.log('SC3_Y_READ_X status=' + asY.status + ' (expect 404) body=' + JSON.stringify(asY.body).slice(0, 120));
  const asX = await hist(X_SLUG, conv);            // positive control: X reads own
  console.log('SC3_X_READ_X status=' + asX.status + ' (expect 200)');
  // DB-level: X conv must have zero rows under Y clinic
  const y = await admin.from('clinics').select('id').eq('slug', Y_SLUG).single();
  const leak = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv).eq('clinic_id', y.data.id);
  const total = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv);
  console.log('SC3_DB_LEAK_COUNT_under_Y=' + leak.count + ' total_rows_for_conv=' + total.count);
} finally {
  await cleanup();
}
process.exit(0);
})();