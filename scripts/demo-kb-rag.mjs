// Populate demo clinic KB + verify real RAG (Gemini embedding -> RPC), all synthetic.
// Mirrors ingestion (writes embedding + embedding_vector) and retrieval
// (match_clinic_documents RPC) using the same Gemini embed API + service role.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = env.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const S_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI = get('GEMINI_API_KEY');
const EMODEL = get('GEMINI_EMBEDDING_MODEL') || 'gemini-embedding-001';
const CID = process.argv[2] ?? '3cf3e588-c044-4d91-8dc8-73118bf3afa3';
const admin = createClient(S_URL, KEY, { auth: { persistSession: false } });

const embed = async (text) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMODEL}:embedContent?key=${GEMINI}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 1536 }) });
  if (!res.ok) throw new Error('embed fail ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return j.embedding?.values;
};

const chunks = (content) => content.match(/.{1,800}/g) || [content];
const ingest = async (subtype, items) => {
  const rows = [];
  for (const it of items) {
    const title = it.name || it.title || subtype;
    const content = JSON.stringify(it);
    let ci = 0;
    for (const c of chunks(content)) rows.push({ clinic_id: CID, type: 'structured', subtype, title, content: c, chunk_index: ci++, document_id: null, structured_data: it, metadata: { uploaded_by: 'demo-owner' } });
  }
  const ins = await admin.from('clinic_ai_knowledge').insert(rows).select('id,content');
  const inserted = [];
  for (const row of (ins.data || [])) {
    const emb = await embed(row.content || '');
    await admin.from('clinic_ai_knowledge').update({ embedding: emb, embedding_vector: emb }).eq('id', row.id);
    inserted.push(row.id);
  }
  return inserted;
};

const svc = await ingest('services', [
  { name: 'فحص أسنان', description: 'فحص شامل', price: 50, duration: 30 },
  { name: 'تنظيف أسنان', description: 'إزالة الجير', price: 70, duration: 45 },
  { name: 'حشوة أسنان', description: 'حشو ترميمي', price: 120, duration: 60 },
  { name: 'علاج عصب', description: 'علاج قناة الجذر', price: 250, duration: 90 },
  { name: 'خلع أسنان', description: 'خلع سن', price: 150, duration: 45 },
  { name: 'تقويم أسنان', description: 'خطة تقويم كاملة', price: 3500, duration: 60 },
  { name: 'زراعة أسنان', description: 'زراعة سن', price: 2500, duration: 120 },
  { name: 'أشعة بانوراما', description: 'تصوير بانورامي', price: 80, duration: 15 },
]);
const fq = await ingest('faqs', [
  { question: 'كم يغرق فحص الأسنان؟', answer: 'فحص الأسنان 50 شيكل في عيادة الابتسامة الحديثة.' },
  { question: 'ما هي سياسة الحجز والإلغاء؟', answer: 'الإلغاء قبل 24 ساعة بدون رسوم.' },
  { question: 'ما أوقات العمل؟', answer: 'الأحد-الخميس 09:00-17:00، الجمعة 09:00-13:00.' },
  { question: 'من هم أطباء التقويم؟', answer: 'الدكتورة ليان محمود أخصائية تقويم.' },
]);
const dc = await ingest('doctors', [
  { name: 'د. أحمد خالد', specialty: 'طبيب أسنان عام' },
  { name: 'د. عمر سامر', specialty: 'زراعة وجراحة أسنان' },
]);
console.log('INGESTED services=' + svc.length + ' faqs=' + fq.length + ' doctors=' + dc.length);

const { data: sample } = await admin.from('clinic_ai_knowledge').select('id').eq('clinic_id', CID).limit(1);
console.log('HAS_ROWS=' + (sample?.length ?? 0));

const retrieve = async (q) => {
  const e = await embed(q);
  const { data, error } = await admin.rpc('match_clinic_documents', { p_clinic_id: CID, p_query_embedding: e, p_match_threshold: 0.1, p_match_count: 3 });
  return error ? [] : (data || []);
};
for (const q of ['كم يغرق فحص الأسنان؟', 'ما أوقات العمل؟', 'من يعالج التقويم؟']) {
  const r = await retrieve(q);
  console.log('Q: ' + q + ' => ' + (r.length ? r[0].content.slice(0, 70) + ' (sim ' + Number(r[0].similarity).toFixed(2) + ')' : '(none)'));
}

// Isolation: Demo clinic chunks must NOT resolve under Shadi Nouri clinic_id.
const embedDummy = await embed('خدمات وأسعار عيادة الابتسامة الحديثة');
const { data: rog } = await admin.rpc('match_clinic_documents', { p_clinic_id: '7fe17ccd-8185-407a-8ec4-33bf6e357c2d', p_query_embedding: embedDummy, p_match_threshold: 0.1, p_match_count: 5 });
console.log('CROSS_CLINIC_COUNT=' + (rog?.length ?? 'ERROR') + ' (expect 0)');
process.exit(0);