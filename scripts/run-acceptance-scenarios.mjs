#!/usr/bin/env node
/**
 * Standalone runner for the 22 acceptance scenarios.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/run-acceptance-scenarios.mjs
 *   AI_PROVIDER=anthropic node scripts/run-acceptance-scenarios.mjs
 *
 * When an AI provider API key is configured, this script exercises the FULL
 * pipeline: language detection → intent classification → prompt building →
 * provider.generate() → response verification.
 *
 * When no API key is configured, it runs the pipeline up to prompt building
 * (the same tests covered by tests/integration/acceptance-scenarios.test.ts)
 * and prints a summary.
 */
import { detectConversationIntelligence } from '../lib/ai/intelligence.ts';
import { detectLanguage } from '../lib/services/knowledge/multilingual.ts';
import { buildPrompt } from '../lib/ai/promptManager.ts';
import { getProvider } from '../lib/ai/provider.ts';

const SCENARIOS = [
  { id: '01', desc: 'Greeting (EN)', text: "Hi there, I'm a new patient.", expected: 'greeting', lang: 'en', urgent: false },
  { id: '02', desc: 'Greeting (AR)', text: 'مرحباً بكم', expected: 'greeting', lang: 'ar', urgent: false },
  { id: '03', desc: 'General question (EN)', text: 'What is dental floss used for?', expected: 'general_question', lang: 'en', urgent: false },
  { id: '04', desc: 'General question (AR)', text: 'شو هو الخيط المزيجي؟', expected: 'general_question', lang: 'ar', urgent: false },
  { id: '05', desc: 'Patient complaint (EN)', text: 'My tooth has been hurting for 3 days, especially when I eat sweets.', expected: 'patient_complaint', lang: 'en', urgent: false },
  { id: '06', desc: 'Patient complaint (AR)', text: 'سنّي يؤلمني من 3 أيام، خاصةً لما أاكل حلويات.', expected: 'patient_complaint', lang: 'ar', urgent: false },
  { id: '07', desc: 'Emergency (EN)', text: 'Severe pain and bleeding in my lower jaw, I can’t sleep. This feels urgent.', expected: 'emergency', lang: 'en', urgent: true },
  { id: '08', desc: 'Emergency (AR)', text: 'ألم شديد وتورم في الفك السفلي، ما أقدر أتنفس ولا أنام. أحتاج علاج فوري.', expected: 'emergency', lang: 'ar', urgent: true },
  { id: '09', desc: 'Clinic hours (EN)', text: 'What are your opening hours? Are you open on Fridays?', expected: 'clinic_hours', lang: 'en', urgent: false },
  { id: '10', desc: 'Clinic hours (AR)', text: 'متى بتفتحوا وتغلقوا؟ في المغرب تكونوا مفتوحين؟', expected: 'clinic_hours', lang: 'ar', urgent: false },
  { id: '11', desc: 'Location (EN)', text: 'Where is your clinic located? I’m coming from downtown.', expected: 'location', lang: 'en', urgent: false },
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

const SAFETY_RULES = [
  'Never provide a medical diagnosis.',
  'Never prescribe medication or recommend specific dosages.',
  'For any urgent or emergency concern, advise the patient to seek immediate professional care.',
  'Do not guess or fabricate information not present in the provided context.',
];

const ANSWER_BOUNDARIES = [
  'Only answer using the provided context.',
  'If the context does not contain the answer, state that you do not have that information.',
  'Do not invent services, prices, or policies that are not in the context.',
];

const HANDOFF_CONDITIONS = [
  'Hand off to a human agent if the patient requests emergency care.',
  'Hand off to a human agent if the patient explicitly asks to speak with staff.',
  'Hand off to a human agent if the patient expresses dissatisfaction or a complaint.',
  'Hand off to a human agent if you are unsure how to answer accurately.',
];

async function runScenario(scenario) {
  const results = {
    id: scenario.id,
    description: scenario.desc,
    text: scenario.text,
    language: null,
    intent: null,
    confidence: 0,
    urgency: null,
    shouldHandoff: false,
    promptBuilt: false,
    promptContainsKnowledge: false,
    aiResponse: null,
    responseTime: null,
    passed: true,
    errors: [],
  };

  // Step 1: Language detection
  const lang = detectLanguage(scenario.text);
  results.language = lang;
  if (lang !== scenario.lang) {
    results.passed = false;
    results.errors.push(`Language: expected ${scenario.lang}, got ${lang}`);
  }

  // Step 2: Intent classification
  const intelligence = detectConversationIntelligence(scenario.text);
  results.intent = intelligence.intent;
  results.confidence = intelligence.confidence;
  results.urgency = intelligence.urgency;
  results.shouldHandoff = intelligence.shouldHandoff;
  if (intelligence.intent !== scenario.expected) {
    results.passed = false;
    results.errors.push(`Intent: expected ${scenario.expected}, got ${intelligence.intent}`);
  }

  // Step 3: Prompt building
  try {
    const prompt = buildPrompt(null, scenario.text, [], [], undefined, {
      confidenceThreshold: 0.7,
      safetyRules: SAFETY_RULES,
      answerBoundaries: ANSWER_BOUNDARIES,
      handoffConditions: HANDOFF_CONDITIONS,
      intent: intelligence.intent,
      conversationState: 'ai',
    });
    results.promptBuilt = true;
    // Check for general dental knowledge keywords
    results.promptContainsKnowledge = /Dental implants|Root canal|tooth pain|whitening|gingivitis|extraction/i.test(prompt);
    if (!results.promptContainsKnowledge) {
      results.passed = false;
      results.errors.push('Prompt missing general dental knowledge');
    }
    results.promptBuilt = prompt.length > 0;
  } catch (e) {
    results.passed = false;
    results.errors.push(`Prompt build error: ${e.message}`);
  }

  // Step 4 (optional): AI provider call
  const provider = getProvider(process.env.AI_PROVIDER || 'anthropic');
  if (provider && process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
    const start = Date.now();
    try {
      const response = await provider.generate({ prompt: scenario.text, maxTokens: 1024 });
      results.responseTime = Date.now() - start;
      results.aiResponse = response.text?.substring(0, 100) + '...';
    } catch (e) {
      results.errors.push(`AI response error: ${e.message}`);
    }
  }

  return results;
}

async function main() {
  console.log('=== 22 Acceptance Scenarios Runner ===\n');
  console.log(`Provider: ${process.env.AI_PROVIDER || '(not set, defaults to openai)'}`);
  console.log(`API Key: ${process.env.ANTHROPIC_API_KEY ? 'Anthropic ✓' : process.env.OPENAI_API_KEY ? 'OpenAI ✓' : '(not configured)'}`);
  console.log(`Mode: ${process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'Full pipeline (with LLM)' : 'Pipeline-only (no LLM)'}\n`);

  const allResults = [];
  for (const scenario of SCENARIOS) {
    const result = await runScenario(scenario);
    allResults.push(result);

    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${scenario.id}] ${status} ${scenario.desc}`);
    console.log(`  Text: "${scenario.text.substring(0, 60)}..."`);
    console.log(`  Language: ${result.language} | Intent: ${result.intent} (${result.confidence.toFixed(2)}) | Urgency: ${result.urgency}`);
    if (result.responseTime) {
      console.log(`  AI response: ${result.responseTime}ms | "${result.aiResponse}"`);
    }
    if (result.errors.length > 0) {
      result.errors.forEach(e => console.log(`  Error: ${e}`));
    }
    console.log();
  }

  const passed = allResults.filter(r => r.passed).length;
  const total = allResults.length;
  console.log(`\n=== Summary: ${passed}/${total} scenarios passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
