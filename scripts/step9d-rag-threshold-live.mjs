#!/usr/bin/env node
/**
 * STEP 9D — RAG Threshold Consistency: LIVE (READ-ONLY) validation.
 *
 * Proves on demo-dental-clinic that passing the clinic-configured
 * confidence_threshold through retrieveContext changes the assembly
 * sufficiency decision vs. the old hard-coded 0.7 default — WITHOUT any
 * write. Only SELECTs + a live getProvider().embed() per query.
 *
 * Usage: npx tsx scripts/step9d-rag-threshold-live.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const { supabaseAdmin } = await import('../lib/supabase/admin.ts');
const { ensureAIProviders } = await import('../lib/ai/providers/registry.ts');
ensureAIProviders();
const { retrieveContext } = await import('../lib/ai/contextRetrieval.ts');

const CID = 'c92da4ab-9a27-a35c-ec35-f511c0110811'; // demo-dental-clinic

const settings = await supabaseAdmin
  .from('clinic_ai_settings').select('confidence_threshold').eq('clinic_id', CID).limit(1).single();
const configured = Number(settings.data?.confidence_threshold);

const QUERIES = [
  { id: 'A', label: 'pricing_exists_in_kb', text: 'كم سعر تنظيف الأسنان؟' },
  { id: 'C', label: 'prevention_not_in_kb', text: 'شو إجراءات الوقاية من تسوس الأسنان؟' },
  { id: 'D', label: 'newtom_not_in_kb', text: 'هل عندكم جهاز NewTom؟' },
];

const out = [];
console.log('configured clinic confidence_threshold =', configured);
for (const q of QUERIES) {
  const row = { id: q.id, label: q.label, query: q.text, configured };
  for (const th of [configured, 0.7]) {
    const c = await retrieveContext(CID, q.text, 5, 2000, th);
    const confs = (c.citations || []).map((x) => Number(x.confidenceScore));
    const key = `default_0.7` === `${th === 0.7 ? 'default_0.7' : 'configured_' + configured}` ? '' : '';
    const maxConf = confs.length ? Math.max(...confs) : 0;
    row[th === configured ? `T_configured_${configured}` : 'T_default_0.7'] = {
      citations: c.citations?.length ?? 0,
      hasSufficientContext: c.hasSufficientContext,
      maxConfidence: Number(maxConf.toFixed(4)),
    };
  }
  out.push(row);
  console.log(JSON.stringify(row));
}

const dir = resolve(process.cwd(), 'transcripts');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const p = resolve(dir, `step9d-rag-threshold-live-${stamp}.json`);
writeFileSync(p, JSON.stringify({ configured_threshold: configured, results: out }, null, 2), 'utf8');
console.log('\nSaved:', p);
console.log('(read-only; no writes performed)');
process.exit(0);
