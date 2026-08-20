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
 */
const EXACT_EMERGENCY = /صعوبة بالتنفس|مش قادر اتنفس|can't breathe|cannot breathe|swelling|تورم كبير|انتفاخ كبير|نزيف|bleeding|swallow|صعوبة بلع|trouble breathing|urgent|طوارئ/i;
const EXACT_CANCEL = /\b(إلغاء|الغاء|الغي|بطل)\b|cancel|cancellation/i;
const EXACT_BOOKING = /\b(احجز|ابدي احجز|بدي حجز|بدي موعد|حجز|book|appointment)\b/i;
const EXACT_RESCHEDULE = /\b(تأجيل|تغيير الموعد|تعديل الموعد|reschedule|change appointment|ارحل الموعد|نقل الموعد)\b/i;
const EXACT_HANDOFF = /\b(بدي احكي مع موظفة|بدي احكي مع موظف|بدي احكي مع الدكتور|بدي حدا من العيادة|مش فاهم|human|agent|staff|call me)\b/i;
const EXACT_GREETING = /^(مرحبا|اهلا|اهلين|صباح الخير|مساء الخير|هاي|هلا|سلام|hello|hi|hey)\b/i;
const EXACT_GOODBYE = /^(شكرا|يسلمو|مع السلامة|باي|bye|goodbye|thanks)\b/i;

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
 * Orchestrates semantic classification: try LLM first, fall back to fast-path,
 * then to a generic UNKNOWN.
 */
export async function classifyIntent(text: string): Promise<SemanticIntentResult> {
  // 1. Fast-path (deterministic, instant) — for explicit/emergency only
  const fast = classifyIntentFastPath(text);
  if (fast) return fast;

  // 2. Primary semantic (LLM)
  const semantic = await classifyIntentSemantic(text);
  if (semantic) return semantic;

  // 3. Fallback to unknown — orchestrator will handle it conversationally
  return { intent: SEMANTIC_INTENTS.UNKNOWN, confidence: 0.2, entities: {} };
}

export function intentLabel(intent: SemanticIntent): string {
  return intent;
}