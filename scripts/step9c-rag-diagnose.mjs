#!/usr/bin/env node
/**
 * STEP 9C — RAG Grounding Investigation (READ-ONLY diagnostic harness).
 *
 * Traces the REAL RAG path layer-by-layer for demo-dental-clinic, printing
 * raw evidence at each stage. Uses only the production modules as-is; NO
 * code/schema/threshold/prompt/provider changes. NO writes (only SELECTs +
 * a live getProvider().embed() call). No appointments.
 *
 * Usage: npx tsx scripts/step9c-rag-diagnose.mjs
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const { supabaseAdmin } = await import('../lib/supabase/admin.ts');
const { getProvider } = await import('../lib/ai/provider.ts');
const { ensureAIProviders } = await import('../lib/ai/providers/registry.ts');
ensureAIProviders();
const { keywordSearchClinic, vectorSearchClinic, hybridSearchClinic } = await import('../lib/services/knowledge/retrieval.ts');
const { rankAndFilterResults } = await import('../lib/services/knowledge/ranking.ts');
const { assembleContext } = await import('../lib/services/knowledge/contextAssembly.ts');
const { generateQueryVariants, getRetrievalLanguage, detectLanguage } = await import('../lib/services/knowledge/multilingual.ts');

const CID = 'c92da4ab-9a27-a35c-ec35-f511c0110811'; // demo-dental-clinic

// 3 query classes: (1) KB service exists, (2) KB knowledge exists, (3) not in KB.
const QUERIES = [
  { id: 'Q1', label: 'service_in_kb', text: 'بدي أعرف أسعار تنظيف الأسنان عندكم' },
  { id: 'Q2', label: 'knowledge_in_kb', text: 'شو إجراءات الوقاية من تسوس الأسنان' },
  { id: 'Q3', label: 'not_in_kb', text: 'هل عندكم عيادة متخصصة بجراحة الفم والفكين في الفرع الثاني؟' },
];

const fmt = (v) => v == null ? 'null' : (typeof v === 'number' ? v.toFixed(4) : String(v));

console.log('==================== DB: clinic_ai_knowledge ====================');
const { data: chunks, error } = await supabaseAdmin
  .from('clinic_ai_knowledge')
  .select('id, clinic_id, type, subtype, title, content, document_id, embedding_vector, embedding, language')
  .eq('clinic_id', CID);
console.log('rows:', chunks?.length ?? error?.message);
if (chunks) {
  chunks.forEach((c) => {
    const ev = c.embedding_vector;
    const e = c.embedding;
    console.log(' *', c.type, '|', c.subtype, '|', String(c.title ?? '').slice(0, 24).padEnd(24),
      '| embedding_vector=', Array.isArray(ev) ? `arr(${ev.length})` : (typeof ev === 'string' ? `str(${ev.slice(0, 18)}…)` : fmt(ev)),
      '| embedding=', Array.isArray(e) ? `arr(${e.length})` : (typeof e === 'string' ? `str(${e.slice(0, 18)}…)` : fmt(e)),
      '| lang=', c.language);
  });
}

console.log('\n========= Query variants & language (per query) =========');
for (const q of QUERIES) {
  console.log(`[${q.id}] ${q.label} lang=${detectLanguage(q.text)} retrLang=${getRetrievalLanguage(q.text) ?? 'none'} variants=${JSON.stringify(generateQueryVariants(q.text))}`);
}

const provider = getProvider();
console.log('\nActive provider:', provider?.id, '| embed() supported:', typeof provider?.embed === 'function');

for (const q of QUERIES) {
  console.log('\n\n########################## ' + q.id + ' — ' + q.label + ' ##########################');
  console.log('QUERY:', q.text);

  // ---- Query embedding (live) ----
  let qEmb = null;
  try {
    const r = await provider.embed(q.text);
    qEmb = r.embedding;
    console.log('query embedding: dims=', Array.isArray(qEmb) ? qEmb.length : 'n/a (type=' + typeof qEmb + ')');
  } catch (e) { console.log('query embedding ERROR:', e.message); }

  // ---- Layer 1: keyword (raw) ----
  console.log('\n--- L1 keywordSearchClinic (raw) ---');
  let kwResults = [];
  try {
    kwResults = await keywordSearchClinic(CID, q.text, { topK: 10 });
    console.log('raw count:', kwResults.length);
    kwResults.slice(0, 6).forEach((r) => console.log('   [kw] id=', String(r.id).slice(0, 8), 'kwScore=', fmt(r.keywordScore), 'sim=', fmt(r.similarity), '|', String(r.content ?? '').slice(0, 55)));
  } catch (e) { console.log('keyword ERROR:', e.message); }

  // ---- Layer 2: vector search / RPC ----
  console.log('\n--- L2 vectorSearchClinic (RPC threshold 0.78) ---');
  let vecResults = [];
  try {
    vecResults = await vectorSearchClinic(CID, q.text, { topK: 10, minScore: 0.78 });
    console.log('raw count:', vecResults.length);
    vecResults.slice(0, 6).forEach((r) => console.log('   [vec] id=', String(r.id).slice(0, 8), 'sim=', fmt(r.similarity), '|', String(r.content ?? '').slice(0, 55)));
  } catch (e) { console.log('vector ERROR:', e.message); }

  // Direct RPC with SAME embedding, threshold 0.0 to expose RPC-level failure.
  if (qEmb && Array.isArray(qEmb)) {
    console.log('   -- direct RPC (threshold 0.0) --');
    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('match_clinic_documents', {
        p_clinic_id: CID, p_query_embedding: qEmb, p_match_threshold: 0.0, p_match_count: 10,
      });
      if (rpcErr) console.log('   RPC ERROR:', rpcErr.message);
      else {
        console.log('   direct RPC count =', rpcData?.length);
        (rpcData || []).slice(0, 10).forEach((r) => console.log('     id=', String(r.id).slice(0, 8), 'sim=', fmt(r.similarity), '|', String(r.content ?? '').slice(0, 55)));
      }
    } catch (e) { console.log('   direct RPC threw:', e.message); }
  }

  // ---- Layer 3: hybrid/fused ----
  console.log('\n--- L3 hybridSearchClinic (fused) ---');
  let hy = [];
  try { hy = await hybridSearchClinic(CID, q.text, { topK: 5, language: getRetrievalLanguage(q.text) }); } catch (e) { console.log('hybrid ERROR:', e.message); }
  console.log('hybrid count:', hy.length);
  hy.slice(0, 8).forEach((r) => console.log('   [hy] vectorScore=', fmt(r.vectorScore), 'kwScore=', fmt(r.keywordScore), 'hybrid=', fmt(r.hybridScore), 'sim=', fmt(r.similarity), '|', String(r.content ?? '').slice(0, 50)));

  // ---- Layer 4: ranking ----
  console.log('\n--- L4 rankAndFilterResults ---');
  const ranked = rankAndFilterResults(hy, q.text);
  console.log('ranked count:', ranked.length);
  ranked.slice(0, 8).forEach((r) => console.log('   [rk] rankingScore=', fmt(r.rankingScore), 'conf=', fmt(r.confidenceScore), 'kw=', fmt(r.keywordScore), 'sim=', fmt(r.similarity), '|', String(r.content ?? '').slice(0, 50)));

  // ---- Layer 5: assembleContext ----
  console.log('\n--- L5 assembleContext (threshold 0.7) ---');
  const assembled = assembleContext(ranked, 2000, 0.7);
  console.log('chunks=', assembled.chunks?.length, 'citations=', assembled.citations?.length,
    'totalTokens=', assembled.totalTokens, 'hasSufficientContext=', assembled.hasSufficientContext, 'conflict=', assembled.hasConflictingContext);
  assembled.citations?.slice(0, 6).forEach((c) => console.log('   [cite] conf=', fmt(c.confidenceScore), 'chunk=', String(c.chunkId).slice(0, 8), '|', String(c.content ?? '').slice(0, 55)));
}

console.log('\nDone. Read-only; no writes performed.');
process.exit(0);

