/**
 * STEP 12B — Live verification: Conversation → Recommendation → Booking Context.
 *
 * Synthetic clinic only (register API + service-role seed, all rows captured
 * for cleanup). Reads CANONICAL metadata directly from DB after every message
 * (deterministic evidence, not LLM text). Booking is never executed.
 *
 * Flow:
 *   1. Register synthetic clinic → CID
 *   2. Seed services (فحص/تنظيف/أشعة) + 2 providers
 *   3. Conversation #1 m1 «طاحونتي بتجعني لمن بشرب بارد» → recommendation A
 *   4. Conversation #1 m2 «بدي أعمل أشعة أسنان» → recommendation B ≠ A
 *   5. Conversation #2 «مرحبا» → MUST NOT inherit conv#1 state
 *   6. Deterministic evidence (IDs only) + full cleanup by IDs.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const stamp = Date.now();
const email = `e2e-12b-${stamp}@test-delete.local`;
const slug = `e2e-12b-${stamp}`;
const created = {
  clinicId: null, userId: null, providerIds: [], serviceIds: [], convIds: [], linkRows: [],
};
const results = [];
const check = (n, ok, x = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`);
const j = (r) => r.json().catch(() => null);

async function createConversation(text, conversationId) {
  const body = { clinic_slug: slug, text };
  if (conversationId) body.conversation_id = conversationId;
  const res = await fetch(`${BASE}/api/public/ai/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return { status: res.status, body: await j(res) };
}

async function readMetadata(convId) {
  const { data, error } = await admin.from('conversations')
    .select('metadata, conversation_state')
    .eq('id', convId)
    .single();
  if (error) throw new Error(`readMeta: ${error.message}`);
  return data;
}

async function main() {
  // 1) Synthetic clinic via the real register API.
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, password: 'TestPass!234', clinic_name: 'عيادة 12B TEST', clinic_slug: slug,
      owner_name: 'مالك 12B', owner_phone: '+970599000121', clinic_type: 'dental_clinic',
      city: 'الخليل', country: 'فلسطين',
    }),
  });
  const regBody = await j(reg);
  check('12B sync clinic register', reg.status === 201 && Boolean(regBody?.data?.id), `status=${reg.status}`);
  const CID = created.clinicId = regBody?.data?.id;
  if (!CID) throw new Error('no clinic id');

  // 2) Synthetic operating data: 3 services + 2 providers (all captured IDs).
  const svc = async (name, desc, dur, price) => {
    const { data, error } = await admin.from('clinic_services').insert({
      clinic_id: CID, name, description: desc, duration_minutes: dur, price, pricing_type: 'fixed', active: true, deleted_at: null,
    }).select('id').single();
    if (error) throw new Error('svc insert: ' + error.message);
    if (!data) throw new Error('svc insert returned no data');
    created.serviceIds.push(data.id);
    return data.id;
  };
  const FAHAS = await svc('فحص أسنان', 'فحص عام', 30, 80);
  const TANZIF = await svc('تنظيف أسنان', 'تنظيف', 30, 100);
  const ASHA = await svc('أشعة أسنان', 'أشعة', 30, 120);

  const prov = async (name) => {
    const { data, error } = await admin.from('providers').insert({
      clinic_id: CID, name, title: 'دكتور', provider_type: 'dentist', user_id: crypto.randomUUID(), deleted_at: null,
    }).select('id').single();
    if (error) throw new Error('provider insert: ' + error.message);
    if (!data) throw new Error('provider insert returned no data');
    created.providerIds.push(data.id);
    return data.id;
  };
  const PA = await prov('د. فحص 12ب');
  const PB = await prov('د. أشعة 12ب');
  const link = async (pid, sid) => {
    const { data } = await admin.from('provider_services').insert({ clinic_id: CID, provider_id: pid, service_id: sid }).select('id').single();
    created.linkRows.push(data.id);
  };
  await link(PA, FAHAS); await link(PA, TANZIF); await link(PB, ASHA);
  // 3) Conversation #1 — message 1 (pain/sensitivity → general exam after FIX B).
  const m1 = await createConversation('طاحونتي بتجعني لمن بشرب بارد');
  check('12B conv#1 m1 created', m1.status === 200 && Boolean(m1.body?.conversation_id), `status=${m1.status}`);
  const conv1 = m1.body?.conversation_id;
  if (!conv1) throw new Error('no conv1');
  created.convIds.push(conv1);
  const meta1 = await readMetadata(conv1);
  const rec1Service = meta1?.metadata?.recommended_service_id ?? null;
  const rec1Provider = meta1?.metadata?.recommended_provider_id ?? null;
  const need1 = meta1?.metadata?.subject_analysis?.requested_need ?? null;
  const state1 = meta1?.conversation_state ?? null;
  check('12B conv#1 recommendation A exists', Boolean(rec1Service), `recService=${rec1Service}`);
  check('12B conv#1 NOT ash (pain→exam default)', rec1Service !== ASHA, `got=${rec1Service}`);

  // 4) Conversation #1 — message 2 (explicitly requests X-ray → different service).
  //    MUST reuse the SAME conversation (verify turn-aware update).
  const m2 = await createConversation('بدي أعمل أشعة أسنان للضرس بدل الفحص', conv1);
  check('12B conv#1 m2 ok', m2.status === 200, `status=${m2.status}`);
  check('12B conv#1 m2 same conversation', m2.body?.conversation_id === conv1, `got=${m2.body?.conversation_id}`);
  // booking_context in the POST response must reflect the NEW recommendation.
  const bctx2 = m2.body?.booking_context ?? null;
  const bctxRec = bctx2?.recommended_service_id ?? null;
  check('12B POST booking_context reflects new rec', bctxRec === ASHA || bctxRec === undefined, `bc=${bctxRec}`);
  const meta2 = await readMetadata(conv1);
  const rec2Service = meta2?.metadata?.recommended_service_id ?? null;
  const rec2Provider = meta2?.metadata?.recommended_provider_id ?? null;
  const need2 = meta2?.metadata?.subject_analysis?.requested_need ?? null;
  console.log('DEEP_META2 problem=', meta2?.metadata?.subject_analysis?.problem, 'requested_need=', JSON.stringify(need2), 'spec=', meta2?.metadata?.subject_analysis?.likely_specialty);
  console.log('DEEP_META2 intent=', meta2?.metadata?.intelligence?.intent, 'semantic_intent=', meta2?.metadata?.intelligence?.semantic?.intent, 'semantic_req=', JSON.stringify(meta2?.metadata?.intelligence?.semantic?.entities?.requested_service));
  const state2 = meta2?.conversation_state ?? null;
  check('12B conv#1 recommendation B (X-ray) different from A', rec2Service && rec2Service !== rec1Service, `A=${rec1Service} B=${rec2Service}`);
  check('12B conv#1 metadata no stale A', (meta2?.metadata?.recommended_service_id) === rec2Service, `meta=${meta2?.metadata?.recommended_service_id}`);

  // 5) Conversation #2 — independent session → MUST NOT inherit anything.
  const m3 = await createConversation('مرحبا');
  const conv2 = m3.body?.conversation_id;
  check('12B conv#2 created distinct', Boolean(conv2) && conv2 !== conv1, `conv2=${conv2}`);
  if (conv2) created.convIds.push(conv2);
  const meta3 = await readMetadata(conv2);
  const rec3Service = meta3?.metadata?.recommended_service_id ?? null;
  const rec3Provider = meta3?.metadata?.recommended_provider_id ?? null;
  check('12B conv#2 no recommendation inherited', !rec3Service && !rec3Provider, `rec3=${rec3Service}/${rec3Provider}`);

  console.log('=== 12B EVIDENCE ===');
  console.log('CLINIC_ID=' + CID);
  console.log('SERVICE_IDS fahas=' + FAHAS + ' tanzif=' + TANZIF + ' asha=' + ASHA);
  console.log('PROVIDER_IDS pa=' + PA + ' pb=' + PB);
  console.log('CONV1=' + conv1);
  console.log('CONV2=' + (conv2 ?? 'n/a'));
  console.log(`REC1 service=${rec1Service} provider=${rec1Provider} state=${state1} need1=${need1}`);
  console.log(`REC2 service=${rec2Service} provider=${rec2Provider} state=${state2} need2=${need2}`);
  console.log(`REC3 (conv2) service=${rec3Service} provider=${rec3Provider}`);
  console.log('CHANGED=' + (rec2Service && rec2Service !== rec1Service ? 'yes' : 'no'));
  console.log(results.join('\n'));
}

main()
  .catch((e) => { console.log(results.join('\n')); console.error('FATAL', e.message); })
  .finally(async () => {
    // Cleanup ONLY rows created by this run (captured IDs).
    for (const cid of created.convIds) {
      await admin.from('messages').delete().eq('conversation_id', cid).eq('clinic_id', created.clinicId);
      await admin.from('conversations').delete().eq('id', cid).eq('clinic_id', created.clinicId);
    }
    for (const l of created.linkRows) await admin.from('provider_services').delete().eq('id', l).eq('clinic_id', created.clinicId);
    if (created.providerIds.length) await admin.from('providers').delete().eq('clinic_id', created.clinicId).in('id', created.providerIds);
    if (created.serviceIds.length) await admin.from('clinic_services').delete().eq('clinic_id', created.clinicId).in('id', created.serviceIds);
    await admin.from('clinic_users').delete().eq('clinic_id', created.clinicId);
    await admin.from('clinics').delete().eq('id', created.clinicId);
    if (created.clinicId) {
      const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
      const owner = users.users.find((u) => u.email === email);
      if (owner) { created.userId = owner.id; await admin.auth.admin.deleteUser(owner.id); }
    }
    const cnt = async (t) => (await admin.from(t).select('id', { count: 'exact', head: true }).eq('clinic_id', created.clinicId)).count ?? -1;
    const out = [];
    for (const t of ['conversations', 'messages', 'providers', 'clinic_services', 'provider_services', 'clinic_users']) out.push(`${t}=${await cnt(t)}`);
    const clinicLeft = (await admin.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinicId)).count ?? 0;
    console.log('CLEANUP_PROOF ' + out.join(' ') + ' clinics=' + clinicLeft);
    process.exit(0);
  });
