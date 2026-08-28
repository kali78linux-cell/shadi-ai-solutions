import { getProvider } from './provider';
import { logEvent } from '@/lib/server/logging';

/**
 * PRIMARY: LLM-based semantic intent classification.
 *
 * This classifier returns structured JSON describing what the patient means,
 * independent of exact wording. The LLM understands Arabic dialects, typos,
 * missing hamza, and a wide range of phrasings.
 *
 * The keyword-based rules remain ONLY as a deterministic fast-path/fallback
 * for obvious explicit actions (e.g. "إلغاء") and emergency safety signals.
 *
 * IMPORTANT: The local Ollama models currently installed (qwen2.5-coder:3b,
 * qwen2.5:3b, llama3.2:3b, qwen2.5:7b) are either too slow or produce poor
 * Arabic output. This architecture is IMPLEMENTED but not QUALITY-VERIFIED.
 */

export const SEMANTIC_INTENTS = {
  GREETING: 'greeting',
  GENERAL_QUESTION: 'general_question',
  DENTAL_GENERAL_QUESTION: 'dental_general_question',
  PATIENT_COMPLAINT: 'patient_complaint',
  CLINIC_INFORMATION: 'clinic_information',
  SERVICE_INFORMATION: 'service_information',
  PROVIDER_INFORMATION: 'provider_information',
  APPOINTMENT_BOOKING: 'appointment_booking',
  APPOINTMENT_CANCELLATION: 'appointment_cancellation',
  APPOINTMENT_RESCHEDULE: 'appointment_reschedule',
  HUMAN_HANDOFF: 'human_handoff',
  URGENT_SIGNAL: 'urgent_signal',
  GOODBYE: 'goodbye',
  UNKNOWN: 'unknown',
} as const;

export type SemanticIntent = (typeof SEMANTIC_INTENTS)[keyof typeof SEMANTIC_INTENTS];

/** Valid lowercase intent VALUES (the model returns lowercase per the prompt). */
const VALID_INTENT_VALUES = new Set<string>(Object.values(SEMANTIC_INTENTS));

export type SemanticIntentResult = {
  intent: SemanticIntent;
  confidence: number;
  entities: {
    problem?: string;
    duration?: string;
    trigger?: string;
    urgency?: string;
    requested_service?: string;
    requested_specialty?: string;
    location?: string;
    time?: string;
  };
  raw?: unknown;
};

const CLASSIFIER_PROMPT = `You are the intent classifier for a dental clinic AI receptionist.
Classify the patient's message into EXACTLY ONE of these intents:
greeting | general_question | dental_general_question | patient_complaint
| clinic_information | service_information | provider_information
| appointment_booking | appointment_cancellation | appointment_reschedule
| human_handoff | urgent_signal | goodbye | unknown

Also extract relevant entities:
- problem: what hurts or the dental issue
- duration: how long the problem has lasted
- trigger: what worsens or triggers it (e.g. cold, hot, pressure)
- urgency: low|normal|high|critical
- requested_service: if the patient names a service/booking desire
- requested_specialty: if the patient names a specialty (implant, orthodontics, whitening, etc.)

Respond with ONLY valid JSON, no markdown:
{"intent": "...", "confidence": 0.0-1.0, "entities": {...}}

Examples to guide you:
- "مرحبا" → greeting
- "طاحونتي بتجعني من مبارح وكل ما اشرب بارد بتقتلني" → patient_complaint with problem=tooth/molar pain, duration="since yesterday", trigger="cold"
- "شو الفرق بين الزراعة والجسر؟" → dental_general_question
- "بدي احجز موعد عند الدكتور" → appointment_booking
- "بدي الغي" → appointment_cancellation
- "بدي اغير موعدي" → appointment_reschedule
- "بدي احكي مع موظفة" → human_handoff
- "عندي تورم كبير وصعوبة بالتنفس" → urgent_signal
- "وين العيادة؟" → clinic_information
- "قديش سعر التنظيف؟" → service_information (when pricing context) OR clinic_information
- "شكرا" → goodbye

Message:`;

/**
 * Primary semantic intent classifier.
 *
 * Uses the LLM when available. Falls back to keyword rules only if:
 * - the LLM call fails/crashes
 * - the model is not configured
 *
 * @param text Patient message
 * @returns SemanticIntentResult or null if classifier unavailable (caller can fall back to keywords)
 */
export async function classifyIntentSemantic(text: string): Promise<SemanticIntentResult | null> {
  let provider;
  try {
    provider = getProvider();
  } catch {
    return null;
  }

  if (!provider || !provider.generate) return null;

  const start = Date.now();
  try {
    const result = await provider.generate({
      prompt: `${CLASSIFIER_PROMPT}\n\n${text}`,
      maxTokens: 200,
      temperature: 0,
    });

    const took = Date.now() - start;

    // Parse the JSON from the model response
    const content = result.text.trim();
    // Find the JSON object (model may wrap it in fences or prose)
    let jsonStr = content;
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    else {
      const braceStart = content.indexOf('{');
      const braceEnd = content.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        jsonStr = content.slice(braceStart, braceEnd + 1);
      }
    }

    const parsed = JSON.parse(jsonStr) as Partial<SemanticIntentResult>;
    // The model returns LOWERCASE intent values per the prompt. Validate against
    // the value set — not the uppercase keys.
    if (!parsed.intent || typeof parsed.intent !== 'string' || !VALID_INTENT_VALUES.has(parsed.intent)) {
      logEvent('intent_classifier_invalid_json', { took, text, intent: parsed.intent, raw: content.slice(0, 300) }, 'error');
      return null;
    }

    logEvent('intent_classifier_llm_ok', { took, text, intent: parsed.intent, confidence: parsed.confidence ?? null });
    return {
      intent: parsed.intent as SemanticIntent,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      entities: parsed.entities ?? {},
      raw: parsed,
    };
  } catch (err) {
    const took = Date.now() - start;
    logEvent('intent_classifier_llm_failed', {
      took,
      error: err instanceof Error ? err.message : String(err),
    }, 'error');
    return null;
  }
}

/**
 * Deterministic FAST-PATH fallback — only for:
 *  1. Very explicit obvious actions ("إلغاء" → cancellation, "بدي احجز" → booking)
 *  2. Emergency safety signals (difficulty breathing, severe swelling)
 * This does NOT replace the LLM classifier.
 *
 * IMPORTANT ROOT-CAUSE FIX: JavaScript `\b` word boundaries are defined by
 * `\w` = [A-Za-z0-9_] which is ASCII-only, so `\b(احجز)\b` could NEVER match
 * any Arabic text — the whole Arabic fast-path was dead. All boundaries below
 * therefore use Unicode letter/digit lookarounds, and common clitic-suffixed
 * verb forms (احجزلي، الغيلي…) are enumerated longest-first so agglutinated
 * Palestinian phrasings still match.
 */
const NO_LETTER_BEFORE = '(?<![\\p{L}\\p{N}])';
const NO_LETTER_AFTER = '(?![\\p{L}\\p{N}])';

/** Builds a pattern that matches any listed phrase with Unicode boundaries. */
function unicodePhrasePattern(phrases: string): RegExp {
  return new RegExp(`${NO_LETTER_BEFORE}(?:${phrases})${NO_LETTER_AFTER}`, 'iu');
}

// Safety net is intentionally broad (fail-safe): extra dialectal emergency
// phrasings only cause a deterministic handoff, never a missed emergency.
const EXACT_EMERGENCY = /صعوبة بالتنفس|صعوبة بالبلع|صعوبة التنفس|صعوبة البلع|مش قادر اتنفس|مش قادرة اتنفس|ما بقادر اتنفس|ما بقدر اتنفس|بتخنق|خنقه|خنقة|can't breathe|cannot breathe|can['’]t breathe|difficulty breathing|trouble breathing|swelling|تورم كبير|انتفاخ كبير|تورم شديد|نزيف|bleeding|swallow|صعوبة بلع|trouble swallowing|urgent|طوارئ/i;

const EXACT_CANCEL = unicodePhrasePattern('إلغاء|الغاء|الغي|الغيلي|الغيها|الغيلها|الغينه|الغيني|بطل الحجز|بطل موعدي|cancel|cancellation');
const EXACT_BOOKING = unicodePhrasePattern('احجزلي|احجزي|احجزنا|احجزها|احجزله|احجزهم|ابدي احجز|بدي احجز|بدي حجز|بدي موعد|اريد حجز|أريد حجز|حجز موعد|احجز|book|booking|appointment');
const EXACT_RESCHEDULE = unicodePhrasePattern('تأجيل الموعد|تاجيل الموعد|تغيير الموعد|تعديل الموعد|بدي اغير موعدي|بدي أغير موعدي|بدي اجدد موعدي|بدي أجدد موعدي|reschedule|change appointment');
const EXACT_HANDOFF = unicodePhrasePattern('بدي احكي مع موظفة|بدي احكي مع موظف|بدي احكي مع الدكتور|بدي حدى من العيادة|بدي حدا من العيادة|مش فاهم|مش فاهمة|human|agent|staff|call me');
// A pure greeting/goodbye: phrase at the start, optionally followed by
// punctuation/whitespace ONLY — "مرحبا بدي احجز" must NOT be a greeting.
const EXACT_GREETING = new RegExp(`^${NO_LETTER_BEFORE}(مرحبا|مرحبة|اهلا|أهلا|اهلين|أهلين|صباح الخير|مساء الخير|مساء النور|هاي|هلا|سلام|hello|hi|hey)${NO_LETTER_AFTER}[\\s،,.!؟?:؛~]*$`, 'iu');
const EXACT_GOODBYE = new RegExp(`^${NO_LETTER_BEFORE}(شكرا|شكراً|يسلمو|يسلموو|مع السلامة|باي|بايباي|bye|goodbye|thanks|thank you)${NO_LETTER_AFTER}[\\s،,.!؟?:؛~]*$`, 'iu');

export function classifyIntentFastPath(text: string): SemanticIntentResult | null {
  const t = text.trim();

  if (EXACT_EMERGENCY.test(t)) {
    return { intent: SEMANTIC_INTENTS.URGENT_SIGNAL, confidence: 0.98, entities: { urgency: 'critical' } };
  }
  if (EXACT_CANCEL.test(t)) return { intent: SEMANTIC_INTENTS.APPOINTMENT_CANCELLATION, confidence: 0.95, entities: {} };
  if (EXACT_RESCHEDULE.test(t)) return { intent: SEMANTIC_INTENTS.APPOINTMENT_RESCHEDULE, confidence: 0.9, entities: {} };
  if (EXACT_BOOKING.test(t)) return { intent: SEMANTIC_INTENTS.APPOINTMENT_BOOKING, confidence: 0.85, entities: {} };
  if (EXACT_HANDOFF.test(t)) return { intent: SEMANTIC_INTENTS.HUMAN_HANDOFF, confidence: 0.95, entities: {} };
  if (EXACT_GREETING.test(t)) return { intent: SEMANTIC_INTENTS.GREETING, confidence: 0.9, entities: {} };
  if (EXACT_GOODBYE.test(t)) return { intent: SEMANTIC_INTENTS.GOODBYE, confidence: 0.9, entities: {} };

  return null;
}

/**
 * Orchestrates semantic classification: emergency safety signals first,
 * then the LLM as PRIMARY, then the deterministic fast-path as a fallback
 * when the LLM is unavailable, then a generic UNKNOWN.
 *
 * Ordering rationale (matches the documented design):
 *  - Emergency signals always short-circuit (safety, deterministic).
 *  - The LLM understands Arabic dialects/typos — it must see the message
 *    first so phrases like "متى أقرب موعد؟" are classified by MEANING
 *    (a question), not short-circuited by the keyword "موعد".
 *  - The keyword fast-path remains as an offline fallback only.
 */
export async function classifyIntent(text: string): Promise<SemanticIntentResult> {
  // 0. Emergency safety signals — always deterministic and first.
  if (EXACT_EMERGENCY.test(text.trim())) {
    return { intent: SEMANTIC_INTENTS.URGENT_SIGNAL, confidence: 0.98, entities: { urgency: 'critical' } };
  }

  // 1. Primary semantic (LLM).
  const semantic = await classifyIntentSemantic(text);
  if (semantic) return semantic;

  // 2. Deterministic fast-path fallback when the LLM is unavailable.
  const fast = classifyIntentFastPath(text);
  if (fast) return fast;

  // 3. Fallback to unknown — orchestrator will handle it conversationally.
  return { intent: SEMANTIC_INTENTS.UNKNOWN, confidence: 0.2, entities: {} };
}

export function intentLabel(intent: SemanticIntent): string {
  return intent;
}