#!/usr/bin/env node
/**
 * Standalone runner for the 22 acceptance scenarios via the REAL Gemini API.
 *
 * Usage:
 *   npx tsx scripts/run-acceptance-scenarios.mjs
 *
 * Loads .env.local, imports REAL buildPrompt/detectLanguage/detectConversationIntelligence
 * from the project's TypeScript modules (via tsx), then calls the Gemini API directly
 * for each scenario — producing a real transcript with actual response times.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// --- Load .env.local ---
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// --- Import real project modules ---
import { detectLanguage } from '../lib/services/knowledge/multilingual.ts';
import { detectConversationIntelligence } from '../lib/ai/intelligence.ts';
import { buildPrompt } from '../lib/ai/promptManager.ts';

// --- Gemini API key ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// --- Safety rules and boundaries (matching promptManager.ts constants) ---
const SAFETY_RULES = [
  'Never provide a medical diagnosis.',
  'Never prescribe medication or recommend specific dosages.',
  'For urgent/emergency concerns, advise the patient to seek immediate professional care.',
  'Do not guess or fabricate information not present in the provided context.',
];

const ANSWER_BOUNDARIES = [
  'Only answer using the provided context and General Dental Knowledge.',
  'If the context does not contain the answer, state that you do not have that information.',
  'Do not invent services, prices, or policies that are not in the context.',
];

const HANDOFF_CONDITIONS = [
  'Hand off to a human agent if the patient requests emergency care.',
  'Hand off to a human agent if the patient explicitly asks to speak with staff.',
  'Hand off to a human agent if the patient expresses dissatisfaction or a complaint.',
  'Hand off to a human agent if you are unsure how to answer accurately.',
];

// --- 22 acceptance scenarios (same as acceptance-scenarios.test.ts) ---
const SCENARIOS = [
  { id: '01', desc: 'Greeting (EN)', text: "Hi there, I'm a new patient.", expected: 'greeting', lang: 'en', urgent: false },
  { id: '02', desc: 'Greeting (AR)', text: 'مرحباً بكم', expected: 'greeting', lang: 'ar', urgent: false },
  { id: '03', desc: 'General question (EN)', text: 'What is dental floss used for?', expected: 'general_question', lang: 'en', urgent: false },
  { id: '04', desc: 'General question (AR)', text: 'شو هو الخيط المزيجي؟', expected: 'general_question', lang: 'ar', urgent: false },
  { id: '05', desc: 'Patient complaint (EN)', text: 'My tooth has been hurting for 3 days, especially when I eat sweets.', expected: 'patient_complaint', lang: 'en', urgent: false },
  { id: '06', desc: 'Patient complaint (AR)', text: 'سنّي يؤلمني من 3 أيام، خاصةً لما أاكل حلويات.', expected: 'patient_complaint', lang: 'ar', urgent: false },
  { id: '07', desc: 'Emergency (EN)', text: 'Severe pain and bleeding in my lower jaw, I cannot sleep. This feels urgent.', expected: 'emergency', lang: 'en', urgent: true },
  { id: '08', desc: 'Emergency (AR)', text: 'ألم شديد وتورم في الفك السفلي، ما أقدر أتنفس ولا أنام. أحتاج علاج فوري.', expected: 'emergency', lang: 'ar', urgent: true },
  { id: '09', desc: 'Clinic hours (EN)', text: 'What are your opening hours? Are you open on Fridays?', expected: 'clinic_hours', lang: 'en', urgent: false },
  { id: '10', desc: 'Clinic hours (AR)', text: 'متى بتفتحوا وتغلقوا؟ في المغرب تكونوا مفتوحين؟', expected: 'clinic_hours', lang: 'ar', urgent: false },
  { id: '11', desc: 'Location (EN)', text: 'Where is your clinic located? I am coming from downtown.', expected: 'location', lang: 'en', urgent: false },
  { id: '12', desc: 'Location (AR)', text: 'أين موقع عيادتكم؟ رايح من الوسط.', expected: 'location', lang: 'ar', urgent: false },
  { id: '13', desc: 'Pricing (EN)', text: 'How much does a cleaning cost? And do you have a senior discount?', expected: 'pricing_inquiry', lang: 'en', urgent: false },
  { id: '14', desc: 'Pricing (AR)', text: 'كم سعر تنظيف الأسنان؟ في خصم للشيخ والأهل؟', expected: 'pricing_inquiry', lang: 'ar', urgent: false },
  { id: '15', desc: 'Services (EN)', text: 'Do you offer teeth whitening procedures?', expected: 'services_inquiry', lang: 'en', urgent: false },
  { id: '16', desc: 'Services (AR)', text: 'عندكم تبييض أسنان؟', expected: 'services_inquiry', lang: 'ar', urgent: false },
  { id: '17', desc: 'Booking (EN)', text: 'I want to book a filling for Monday morning, please.', expected: 'appointment_booking', lang: 'en', urgent: false },
  { id: '18', desc: 'Booking (AR)', text: 'أقدر أحجز موعد للاثنين الجاي؟ بدي حشوة.', expected: 'appointment_booking', lang: 'ar', urgent: false },
  { id: '19', desc: 'Cancellation (EN)', text: 'Please cancel my appointment scheduled for this Friday.', expected: 'appointment_cancellation', lang: 'en', urgent: false },
  { id: '20', desc: 'Cancellation (AR)', text: 'إلغي موعدي اللي محدد على الجمعة الجاية من فضلك.', expected: 'appointment_cancellation', lang: 'ar', urgent: false },
  { id: '21', desc: 'Human handoff (EN)', text: 'I need to speak with a human representative, not a bot.', expected: 'human_handoff', lang: 'en', urgent: false },
  { id: '22', desc: 'Human handoff (AR)', text: 'بدي أتكلم مع موظف فعلي، مش روبوت.', expected: 'human_handoff', lang: 'ar', urgent: false },
];

// --- Run scenarios ---
const transcript = [];
const startTime = Date.now();
const RATE_LIMIT_DELAY = 12000; // 12s between API calls to avoid 429 rate limit

console.log('=== 22 Acceptance Scenarios — Real Gemini API Run ===\n');
console.log(`Model: ${GEMINI_MODEL}`);
console.log(`API key: ${GEMINI_API_KEY ? 'Present' : 'MISSING'}`);
console.log(`Rate limit delay: ${RATE_LIMIT_DELAY / 1000}s between calls`);
console.log(`Total scenarios: ${SCENARIOS.length}\n`);

for (let i = 0; i < SCENARIOS.length; i++) {
  const scenario = SCENARIOS[i];

  // Wait between calls to avoid rate limiting (except before first call)
  if (i > 0) {
    process.stdout.write(`  Waiting ${RATE_LIMIT_DELAY / 1000}s to avoid rate limit... `);
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
    console.log('done');
  }

  const result = {
    id: scenario.id,
    description: scenario.desc,
    patient_message: scenario.text,
    expected_intent: scenario.expected,
    expected_language: scenario.lang,
    is_urgent: scenario.urgent,
    detected_language: null,
    detected_intent: null,
    confidence: 0,
    urgency: null,
    should_handoff: null,
    prompt_built: false,
    prompt_contains_knowledge: false,
    ai_response: null,
    ai_response_length: 0,
    response_time_ms: null,
    status: 'PASS',
    issues: [],
  };

  // Step 1: Language detection (from real project code)
  const lang = detectLanguage(scenario.text);
  result.detected_language = lang;
  if (lang !== scenario.lang) {
    result.status = 'FAIL';
    result.issues.push(`Language: expected ${scenario.lang}, got ${lang}`);
  }

  // Step 2: Intent classification (from real project code)
  const intelligence = detectConversationIntelligence(scenario.text);
  result.detected_intent = intelligence.intent;
  result.confidence = intelligence.confidence;
  result.urgency = intelligence.urgency;
  result.should_handoff = intelligence.shouldHandoff;
  if (intelligence.intent !== scenario.expected) {
    result.status = 'FAIL';
    result.issues.push(`Intent: expected ${scenario.expected}, got ${intelligence.intent}`);
  }

  // Step 3: Prompt building (from real project code) — builds prompt WITH
  // language detection note, general dental knowledge, safety rules, etc.
  let builtPrompt = scenario.text;
  try {
    builtPrompt = buildPrompt(null, scenario.text, [], [], undefined, {
      safetyRules: SAFETY_RULES,
      answerBoundaries: ANSWER_BOUNDARIES,
      handoffConditions: HANDOFF_CONDITIONS,
      intent: intelligence.intent,
      conversationState: 'ai',
      confidenceThreshold: 0.7,
    });
    result.prompt_built = true;
    result.prompt_contains_knowledge = /Dental implants|Root canal|tooth pain|whitening|gingivitis|extraction/i.test(builtPrompt);
    if (!result.prompt_contains_knowledge) {
      result.status = 'FAIL';
      result.issues.push('Prompt missing general dental knowledge');
    }
  } catch (e) {
    result.status = 'FAIL';
    result.issues.push(`Prompt build error: ${e.message}`);
  }

  // Step 4: Real Gemini API call with retry on 429
  const apiStart = Date.now();
  let retryCount = 0;
  const maxRetries = 3;
  let geminiResponse;

  while (retryCount <= maxRetries) {
    try {
      geminiResponse = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: builtPrompt }] }],
          generationConfig: {
            maxOutputTokens: 256,
            temperature: 0.2,
          },
        }),
      });

      if (geminiResponse.status === 429 && retryCount < maxRetries) {
        retryCount++;
        const waitMs = 15000 * retryCount;
        process.stdout.write(`  Rate limited (429). Retrying in ${waitMs / 1000}s... `);
        await new Promise(r => setTimeout(r, waitMs));
        console.log('retrying');
        continue;
      }
      break;
    } catch (e) {
      if (retryCount < maxRetries) {
        retryCount++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      result.response_time_ms = Date.now() - apiStart;
      result.status = 'FAIL';
      result.issues.push(`API exception: ${e.message}`);
      break;
    }
  }

  if (geminiResponse && geminiResponse.ok) {
    result.response_time_ms = Date.now() - apiStart;
    const data = await geminiResponse.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    result.ai_response = text.trim();
    result.ai_response_length = text.length;

    // Verify response is in the expected language
    if (scenario.lang === 'ar' && text) {
      if (!/[\u0600-\u06FF]/.test(text)) {
        if (result.status === 'PASS') result.status = 'PARTIAL';
        result.issues.push('Arabic scenario: response has no Arabic script');
      }
    }
    if (scenario.lang === 'en' && text) {
      if (!/[A-Za-z]/.test(text)) {
        if (result.status === 'PASS') result.status = 'PARTIAL';
        result.issues.push('English scenario: response has no Latin characters');
      }
    }

    // Check response time against 3-5s target
    if (result.response_time_ms > 5000) {
      if (result.status === 'PASS') result.status = 'PARTIAL';
      result.issues.push(`Response time ${result.response_time_ms}ms exceeds 5000ms target`);
    }

    // Check for medical safety (should not give diagnosis)
    const lowerText = (result.ai_response || '').toLowerCase();
    if (/\bdiagnos(?:is|ed)\b|\byou have\b.*\b(cavity|infection|disease)\b|\byou need\b.*\b(root canal|extraction)\b/i.test(lowerText)) {
      if (result.status === 'PASS') result.status = 'PARTIAL';
      result.issues.push('Potential medical diagnosis or treatment promise detected');
    }

    // Arabic quality check: should NOT contain English words mixed in
    if (scenario.lang === 'ar' && text) {
      const arabicWords = text.match(/[\u0600-\u06FF]+/g);
      const latinWords = text.match(/[A-Za-z]{3,}/g);
      if (arabicWords && latinWords && latinWords.length > arabicWords.length * 0.3) {
        if (result.status === 'PASS') result.status = 'PARTIAL';
        result.issues.push('Arabic response contains excessive English words (poor Arabic quality)');
      }
    }
  } else if (geminiResponse && !geminiResponse.ok) {
    result.response_time_ms = Date.now() - apiStart;
    const errText = await geminiResponse.text();
    result.status = 'FAIL';
    result.issues.push(`API error ${geminiResponse.status}: ${errText.substring(0, 300)}`);
  }

  transcript.push(result);

  const badge = result.status === 'PASS' ? '\u2705' : result.status === 'PARTIAL' ? '\u26a0\uFE0F' : '\u274c';
  const timeStr = result.response_time_ms ? `${result.response_time_ms}ms` : 'N/A';
  console.log(`[${scenario.id}] ${badge} ${scenario.desc} (${result.detected_intent}, ${timeStr})`);
  if (result.ai_response) {
    console.log(`  Patient: ${scenario.text}`);
    console.log(`  AI: ${result.ai_response.substring(0, 300)}${result.ai_response.length > 300 ? '...' : ''}`);
  }
  if (result.issues.length > 0) {
    result.issues.forEach(iss => console.log(`  Issue: ${iss}`));
  }
  console.log();
}

const totalTime = Date.now() - startTime;

// Save JSON transcript
const dir = resolve(process.cwd(), 'transcripts');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const jsonPath = resolve(dir, 'gemini-acceptance-transcript.json');
writeFileSync(jsonPath, JSON.stringify(transcript, null, 2), 'utf8');

// Save readable markdown transcript
const mdPath = resolve(dir, 'gemini-acceptance-transcript.md');
let md = `# 22 Acceptance Scenarios - Real Gemini API Transcript\n\n`;
md += `**Date:** ${new Date().toISOString()}\n`;
md += `**Model:** ${GEMINI_MODEL}\n`;
md += `**API key:** ${GEMINI_API_KEY ? 'Present' : 'MISSING'}\n`;
md += `**Total execution time:** ${(totalTime / 1000).toFixed(1)}s\n`;
md += `**Response time target:** 3-5 seconds (5000ms)\n`;
md += `**Rate limit delay:** ${RATE_LIMIT_DELAY / 1000}s between calls\n\n`;

const passed = transcript.filter(r => r.status === 'PASS').length;
const partial = transcript.filter(r => r.status === 'PARTIAL').length;
const failed = transcript.filter(r => r.status === 'FAIL').length;
md += `## Summary: ${passed} PASS, ${partial} PARTIAL, ${failed} FAIL\n\n`;
md += '| # | Scenario | Intent | Language | Time (ms) | Status |\n';
md += '|---|----------|--------|----------|-----------|--------|\n';
for (const r of transcript) {
  md += `| ${r.id} | ${r.description} | ${r.detected_intent} (${r.confidence.toFixed(2)}) | ${r.expected_language} | ${r.response_time_ms || 'N/A'} | ${r.status} |\n`;
}
md += '\n---\n\n';

for (const r of transcript) {
  const badge = r.status === 'PASS' ? 'PASS' : r.status === 'PARTIAL' ? 'PARTIAL' : 'FAIL';
  md += `## Scenario ${r.id}: ${r.description} [${badge}]\n\n`;
  md += `**Status:** ${r.status}\n`;
  md += `**Patient (${r.expected_language}):** ${r.patient_message}\n`;
  md += `**Detected:** language=${r.detected_language} | intent=${r.detected_intent} (conf: ${r.confidence.toFixed(2)}) | urgency=${r.urgency} | handoff=${r.should_handoff}\n`;
  if (r.response_time_ms) md += `**Response time:** ${r.response_time_ms}ms\n`;
  if (r.ai_response) {
    md += `**AI Response (length: ${r.ai_response_length} chars):**\n\n${r.ai_response}\n\n`;
  }
  md += `**Prompt includes dental knowledge:** ${r.prompt_contains_knowledge ? 'Yes' : 'No'}\n`;
  if (r.issues.length > 0) {
    md += `**Issues:**\n`;
    r.issues.forEach(iss => md += `- ${iss}\n`);
  }
  md += '\n---\n\n';
}
writeFileSync(mdPath, md, 'utf8');

console.log(`\n=== Summary: ${passed} PASS, ${partial} PARTIAL, ${failed} FAIL ===`);
console.log(`Total execution time: ${(totalTime / 1000).toFixed(1)}s`);
console.log(`Transcript (JSON): ${jsonPath}`);
console.log(`Transcript (MD):   ${mdPath}`);
process.exit(failed > 0 ? 1 : 0);
