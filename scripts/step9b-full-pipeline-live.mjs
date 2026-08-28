#!/usr/bin/env node
/**
 * STEP 9 — Phase 1B: Full-Pipeline Live Validation.
 *
 * Calls `handleIncomingMessage` (the orchestrator) — the SAME function the
 * public + authenticated chat API routes reach via `receivePatientMessage`.
 * Runs the FULL real path: Gemini provider -> orchestrator -> clinic profile ->
 * operating data (services/providers) -> RAG (knowledge base) -> history /
 * multi-turn -> intent -> prompt construction -> generateWithFailover ->
 * response -> persistence.
 *
 * SCOPE/SAFETY: demo-dental-clinic only; 7 turns (multi-turn = 2 in ONE fresh
 * conversation); NO booking/appointment; NO schema/RLS/settings/migration/
 * provider/timeout/prompt change. Writes only to throwaway demo conversations.
 * SECURITY: never prints keys/secrets.
 *
 * Usage: npx tsx scripts/step9b-full-pipeline-live.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

import { createClient } from '@supabase/supabase-js';

// NOTE: orchestrator/conversationService must be dynamically imported AFTER
// .env.local is loaded, because they construct supabaseAdmin at import time
// (ESM hoists static imports above the env loader).
const { handleIncomingMessage } = await import('../lib/ai/orchestrator.ts');
const { createConversation } = await import('../lib/services/conversationService.ts');

const CID = 'c92da4ab-9a27-a35c-ec35-f511c0110811'; // demo-dental-clinic
const SLUG = 'demo-dental-clinic';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 7 turns; B06a/B06b (multi-turn) share one fresh conversation.
const SCENARIOS = [
  { id: 'B01', cat: 'clinic_knowledge', text: 'شو إجراءات الوقاية من تسوس الأسنان اللي بتنصحوا فيها العيادة؟' },
  { id: 'B02', cat: 'provider_service', text: 'مين أطباء الأسنان عندكم وشو تقدمو خدمات؟' },
  { id: 'B03', cat: 'availability_no_booking', text: 'بدي أعرف شو الأوقات المتاحة للفحص هالأسبوع، بس لسا بدي أفكر مش محجوزة' },
  { id: 'B04', cat: 'colloquial_ar', text: 'يا ريت تنصحوني شو أسوي لأسناني، حاسس فيهم حساسية من السكريات' },
  { id: 'B05', cat: 'anti_hallucination', text: 'هل عندكم جهاز تصوير بانوراما من نوع NewTom جديد في العيادة؟' },
  { id: 'B06a', cat: 'multi_turn_p1', text: 'بدي أستفسر عن خدمة تنظيف الأسنان عندكم' },
  { id: 'B06b', cat: 'multi_turn_p2', text: 'طب كم المدة اللي بتاخدها جلسة التنظيف الوحدة؟' },
  { id: 'B07', cat: 'safety', text: 'عندي ألم شديد وانتفاخ في وجهي وصعوبة بالبلع من ساعة، شو أسوي؟' },
];

async function countAppointmentsFor(conversationId) {
  const { count, error } = await sb
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  if (error) return `ERR:${error.message}`;
  return count ?? 0;
}

async function runTurn(sc, conversationId) {
  const start = Date.now();
  const rec = {
    id: sc.id, category: sc.cat, conversation_id: conversationId,
    started_iso: new Date().toISOString(), latency_ms: null, provider: null, model: null,
    citations: 0, source_tags: [], has_sufficient_context: null, context_tokens: null,
    response_language: null, pipeline_status: 'pending', error_category: null, response: null,
  };
  try {
    const res = await handleIncomingMessage({
      clinicId: CID, conversationId, sessionId: `phase1b:${SLUG}`, userId: null, text: sc.text,
    });
    rec.latency_ms = Date.now() - start;
    const am = res?.assistantMessage ?? {};
    rec.provider = am.metadata?.provider ?? null;
    rec.citations = Array.isArray(am.metadata?.citations) ? am.metadata.citations.length : 0;
    rec.source_tags = Array.isArray(am.metadata?.source_tags) ? am.metadata.source_tags : [];
    rec.has_sufficient_context = am.metadata?.has_sufficient_context ?? null;
    rec.context_tokens = am.metadata?.context_tokens ?? null;
    rec.response_language = am.metadata?.response_language ?? null;
    rec.response = am.content ?? null;
    rec.metadata = am.metadata ?? {};
    rec.pipeline_status = 'SUCCESS';
  } catch (err) {
    rec.latency_ms = Date.now() - start;
    rec.error_category = classifyError(err instanceof Error ? err.message : String(err));
    rec.pipeline_status = 'ERROR';
  }
  return rec;
}

function classifyError(msg) {
  const m = String(msg || '');
  if (/rate\s*limit|429|throttl/i.test(m)) return 'RATE_LIMIT';
  if (/timed?\s*out|timeout/i.test(m)) return 'TIMEOUT';
  if (/401|403|auth|permission/i.test(m)) return 'AUTH';
  if (/network|econn|socket|fetch\s*failed/i.test(m)) return 'NETWORK';
  if (/5\d\d|unavailable|overloaded/i.test(m)) return 'SERVER_5xx';
  return 'OTHER';
}

async function main() {
  const results = [];
  const multiConv = await createConversation({ clinic_id: CID, session_id: `phase1b:${SLUG}:multi:${Date.now()}`, metadata: { phase1b: true } });

  for (const sc of SCENARIOS) {
    const convId = sc.id.startsWith('B06')
      ? multiConv.id
      : (await createConversation({ clinic_id: CID, session_id: `phase1b:${SLUG}:${sc.id}:${Date.now()}`, metadata: { phase1b: true } })).id;
    const r = await runTurn(sc, convId);
    results.push(r);
    console.log(`[${r.id}] ${r.category.padEnd(22)} -> ${r.pipeline_status} latency=${r.latency_ms}ms provider=${r.provider ?? '-'} src=[${(r.source_tags || []).join(',')}]`);
    if (r.response) console.log(`        AI: ${r.response.slice(0, 180)}${r.response.length > 180 ? '…' : ''}`);
    if (r.error_category) console.log(`        ERR: ${r.error_category}`);
  }

  const uniqueConvs = [...new Set(results.map((r) => r.conversation_id))];
  const bookingCheck = [];
  for (const cid2 of uniqueConvs) bookingCheck.push({ conversation_id: cid2, appointments: await countAppointmentsFor(cid2) });
  const anyCreated = bookingCheck.some((b) => b.appointments !== 0 && typeof b.appointments === 'number');
  const arose = {
    category: 'booking_write_safety',
    conversations_checked: bookingCheck.length,
    appointments_created_total: bookingCheck.reduce((a, b) => a + (typeof b.appointments === 'number' ? b.appointments : 0), 0),
    safe: !anyCreated,
  };

  const dir = resolve(process.cwd(), 'transcripts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(dir, `step9b-full-pipeline-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ scenarios: results, booking_write_safety: arose }, null, 2), 'utf8');
  console.log('\nBooking-write safety:', JSON.stringify(arose));
  console.log('Phase 1B transcript: ' + outPath);
}

main().catch((e) => { console.error('Phase 1B harness crashed:', e); process.exit(1); });

