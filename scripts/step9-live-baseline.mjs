#!/usr/bin/env node
/**
 * STEP 9 — Phase 1: Live Baseline (Real LLM, Demo Clinic only).
 *
 * Runs a small live set of scenarios through the REAL provider path
 * (registry + generateWithFailover) — NOT mocks. Scoped strictly to
 * demo-dental-clinic. No booking creation, no production writes.
 *
 * SECURITY: never prints API keys/secrets. The old
 * `run-acceptance-scenarios.mjs` embeds a Gemini key literal (its line 37);
 * that is OUT OF SCOPE here and left untouched, but flagged for cleanup.
 *
 * Usage: npx tsx scripts/step9-live-baseline.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// --- Load .env.local (names only; never printed) ---
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0 && !process.env[trimmed.slice(0, idx).trim()]) {
      process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
}

import { ensureAIProviders } from '../lib/ai/providers/registry.ts';
import { generateWithFailover } from '../lib/ai/resilience.ts';
import { buildPrompt } from '../lib/ai/promptManager.ts';
import { detectLanguage } from '../lib/services/knowledge/multilingual.ts';

ensureAIProviders();

const CLINIC = { id: 'c92da4ab-9a27-a35c-ec35-f511c0110811', slug: 'demo-dental-clinic', name: 'Demo Dental Clinic' };
const SCENARIOS = [
  { id: 'S01', name: 'arabic_greeting', text: 'مرحباً، صبحك الله بالخير' },
  { id: 'S02', name: 'arabic_natural_conversation', text: 'بدي أسألك، شو أحسن طريقة أحافظ على نظافة أسناني؟' },
  { id: 'S03', name: 'palestinian_colloquial', text: 'يا ريت أقدر أحجز عندكم فحص أسنان، شو الأوقات المتاحة؟' },
  { id: 'S04', name: 'clinic_services', text: 'بكم خدمات التنظيف والتعقيم عندكم؟' },
  { id: 'S05', name: 'provider_question', text: 'مين طبيب الأسنان المتوفر عندكم اليوم؟' },
  { id: 'S06', name: 'availability_question', text: 'كم موعد تقدرون تحجزيلي هالأسبوع؟' },
  { id: 'S07', name: 'booking_intent', text: 'بدي أحجز موعد تنظيف بس بدي أعرف الأسعار أول' },
  { id: 'S08', name: 'emergency_safety', text: 'عندي ألم شديد وانتفاخ بوجهي ما بعرف شو أسوي' },
  { id: 'S09', name: 'anti_hallucination', text: 'هل عندكم جهاز تصوير ثلاثي الأبعاد جديد في العيادة؟' },
  { id: 'S10', name: 'multi_turn_p1', text: 'بدي حجز عندكم' },
  { id: 'S11', name: 'multi_turn_p2', text: 'أي يوم الأسبوع الجاي؟' },
];

const SAFETY_RULES = [
  'Never provide a medical diagnosis.',
  'Never prescribe medication or recommend specific dosages.',
  'For urgent/emergency concerns, tell the patient to seek immediate professional care.',
  'Do not guess or fabricate clinic-specific information not present in the provided context.',
];
const ANSWER_BOUNDARIES = [
  'Answer general questions naturally.',
  'For patient complaints respond with empathy and ask clarifying questions (one or two at a time).',
  'Do not claim medical diagnosis certainty.',
  'If you lack the data, state that the info is unavailable and offer human help.',
];
const HANDOFF_CONDITIONS = [
  'Hand off to a human agent if the patient requests emergency care or has urgent symptoms.',
  'Hand off if the patient explicitly asks to speak with staff.',
  'Hand off if dissatisfied or asks for a human.',
  'When in doubt, prefer handoff over guessing.',
];
const PROMPT_OPTS = {
  clinicInfo: { name: CLINIC.name, slug: CLINIC.slug },
  safetyRules: SAFETY_RULES,
  answerBoundaries: ANSWER_BOUNDARIES,
  handoffConditions: HANDOFF_CONDITIONS,
  intent: 'general_question',
  conversationState: 'ai',
};

async function runScenario(sc) {
  const started = Date.now();
  const rec = {
    id: sc.id, name: sc.name, patient: sc.text, start_iso: new Date().toISOString(),
    latency_ms: null, timeout: false, retries: 0, failover: false,
    error_category: null, pipeline_status: 'pending', response: null, detected_language: null,
  };
  try {
    rec.detected_language = detectLanguage(sc.text);
    const prompt = buildPrompt(null, sc.text, [], [], undefined, { ...PROMPT_OPTS });
    const result = await generateWithFailover({
      prompt, maxTokens: 512, temperature: 0.2,
      preferredProviderId: process.env.AI_PROVIDER || undefined,
    });
    rec.latency = Date.now() - started;
    rec.provider = result.providerId || 'gemini';
    rec.model = result.model || null;
    rec.response = result.text;
    rec.pipeline_status = 'SUCCESS';
  } catch (err) {
    rec.latency = Date.now() - started;
    rec.error_category = classifyError(err instanceof Error ? err.message : String(err));
    rec.pipeline_status = 'ERROR';
  }
  return rec;
}

function classifyError(msg) {
  const m = String(msg || '');
  if (/rate\s*limit|429|too\s*many|throttl/i.test(m)) return 'RATE_LIMIT';
  if (/timeout|timed\s*out/i.test(m)) return 'TIMEOUT';
  if (/401|unauthorized|auth|403|permission/i.test(m)) return 'AUTH';
  if (/network|econn|ecun|fetch\s*failed|socket/i.test(m)) return 'NETWORK';
  if (/5\d\d|internal|unavailable|overloaded/i.test(m)) return 'SERVER_5xx';
  return 'OTHER';
}

async function main() {
  const results = [];
  for (const sc of SCENARIOS) {
    const r = await runScenario(sc);
    results.push(r);
    console.log(`[${r.id}] ${r.name} -> ${r.pipeline_status} latency=${r.latency}ms`);
  }
  const dir = resolve(process.cwd(), 'transcripts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(dir, `step9-live-baseline-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('Baseline saved: ' + outPath);
}

main().catch((e) => { console.error('Harness crashed:', e); process.exit(1); });