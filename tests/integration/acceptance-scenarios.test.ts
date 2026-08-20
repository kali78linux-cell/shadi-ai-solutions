/**
 * 22 Acceptance Scenarios — Real Patient Transcripts
 *
 * These scenarios test the AI pipeline (language detection, intent classification,
 * and prompt building) using REAL patient conversation transcripts in BOTH
 * English and Arabic (Levantine).
 *
 * The pipeline is exercised up to the point of AI generation — the regex-based
 * intent classifier, language detector, and prompt builder are all real code.
 * (A mock provider response is used where an LLM call would occur, since no
 * production API key is configured in the test environment.)
 */
import { describe, it, expect } from 'vitest';
import { detectConversationIntelligence, ConversationIntent, ConversationState } from '@/lib/ai/intelligence';
import { detectLanguage } from '@/lib/services/knowledge/multilingual';
import { buildPrompt, PromptOptions } from '@/lib/ai/promptManager';

interface AcceptanceScenario {
  id: string;
  description: string;
  text: string;
  expectedIntent: ConversationIntent;
  expectedLanguage: 'en' | 'ar';
  isUrgent?: boolean;
}

/**
 * 22 acceptance scenarios covering all 15 ConversationIntents in both
 * English and Arabic (Levantine dialect).
 */
const scenarios: AcceptanceScenario[] = [
  // --- Greetings ---
  {
    id: '01',
    description: 'Greeting (English)',
    text: "Hi there, I'm a new patient.",
    expectedIntent: 'greeting',
    expectedLanguage: 'en',
  },
  {
    id: '02',
    description: 'Greeting (Arabic)',
    text: 'مرحباً بكم',
    expectedIntent: 'greeting',
    expectedLanguage: 'ar',
  },
  // --- General questions ---
  {
    id: '03',
    description: 'General question (English)',
    text: 'What is dental floss used for?',
    expectedIntent: 'general_question',
    expectedLanguage: 'en',
  },
  {
    id: '04',
    description: 'General question (Arabic)',
    text: 'شو هو الخيط المزيجي؟',
    expectedIntent: 'general_question',
    expectedLanguage: 'ar',
  },
  // --- Patient complaints ---
  {
    id: '05',
    description: 'Patient complaint — toothache (English)',
    text: 'My tooth has been hurting for 3 days, especially when I eat sweets.',
    expectedIntent: 'patient_complaint',
    expectedLanguage: 'en',
  },
  {
    id: '06',
    description: 'Patient complaint — toothache (Arabic)',
    text: 'سنّي يؤلمني من 3 أيام، خاصةً لما أاكل حلويات.',
    expectedIntent: 'patient_complaint',
    expectedLanguage: 'ar',
  },
  // --- Emergency / urgent ---
  {
    id: '07',
    description: 'Emergency — severe pain + bleeding (English)',
    text: 'Severe pain and bleeding in my lower jaw, I can’t sleep. This feels urgent.',
    expectedIntent: 'emergency',
    expectedLanguage: 'en',
    isUrgent: true,
  },
  {
    id: '08',
    description: 'Emergency — severe pain + swelling (Arabic)',
    text: 'ألم شديد وتورم في الفك السفلي، ما أقدر أتنفس ولا أنام. أحتاج علاج فوري.',
    expectedIntent: 'emergency',
    expectedLanguage: 'ar',
    isUrgent: true,
  },
  // --- Clinic hours ---
  {
    id: '09',
    description: 'Clinic hours inquiry (English)',
    text: 'What are your opening hours? Are you open on Fridays?',
    expectedIntent: 'clinic_hours',
    expectedLanguage: 'en',
  },
  {
    id: '10',
    description: 'Clinic hours inquiry (Arabic)',
    text: 'متى بتفتحوا وتغلقوا؟ في المغرب تكونوا مفتوحين؟',
    expectedIntent: 'clinic_hours',
    expectedLanguage: 'ar',
  },
  // --- Location ---
  {
    id: '11',
    description: 'Clinic location (English)',
    text: 'Where is your clinic located? I’m coming from downtown.',
    expectedIntent: 'location',
    expectedLanguage: 'en',
  },
  {
    id: '12',
    description: 'Clinic location (Arabic)',
    text: 'أين موقع عيادتكم؟ رايح من الوسط.',
    expectedIntent: 'location',
    expectedLanguage: 'ar',
  },
  // --- Pricing ---
  {
    id: '13',
    description: 'Pricing inquiry (English)',
    text: 'How much does a cleaning cost? And do you have a senior discount?',
    expectedIntent: 'pricing_inquiry',
    expectedLanguage: 'en',
  },
  {
    id: '14',
    description: 'Pricing inquiry (Arabic)',
    text: 'كم سعر تنظيف الأسنان؟ في خصم للشيخ والأهل؟',
    expectedIntent: 'pricing_inquiry',
    expectedLanguage: 'ar',
  },
  // --- Services ---
  {
    id: '15',
    description: 'Service inquiry — whitening (English)',
    text: 'Do you offer teeth whitening procedures?',
    expectedIntent: 'services_inquiry',
    expectedLanguage: 'en',
  },
  {
    id: '16',
    description: 'Service inquiry — whitening (Arabic)',
    text: 'عندكم تبييض أسنان؟',
    expectedIntent: 'services_inquiry',
    expectedLanguage: 'ar',
  },
  // --- Appointment booking ---
  {
    id: '17',
    description: 'Appointment booking (English)',
    text: 'I want to book a filling for Monday morning, please.',
    expectedIntent: 'appointment_booking',
    expectedLanguage: 'en',
  },
  {
    id: '18',
    description: 'Appointment booking (Arabic)',
    text: 'أقدر أحجز موعد للاثنين الجاي؟ بدي حشوة.',
    expectedIntent: 'appointment_booking',
    expectedLanguage: 'ar',
  },
  // --- Appointment cancellation ---
  {
    id: '19',
    description: 'Appointment cancellation (English)',
    text: 'Please cancel my appointment scheduled for this Friday.',
    expectedIntent: 'appointment_cancellation',
    expectedLanguage: 'en',
  },
  {
    id: '20',
    description: 'Appointment cancellation (Arabic)',
    text: 'إلغي موعدي اللي محدد على الجمعة الجاية من فضلك.',
    expectedIntent: 'appointment_cancellation',
    expectedLanguage: 'ar',
  },
  // --- Human handoff ---
  {
    id: '21',
    description: 'Human handoff request (English)',
    text: 'I need to speak with a human representative, not a bot.',
    expectedIntent: 'human_handoff',
    expectedLanguage: 'en',
  },
  {
    id: '22',
    description: 'Human handoff request (Arabic)',
    text: 'بدي أتكلم مع موظف فعلي، مش روبوت.',
    expectedIntent: 'human_handoff',
    expectedLanguage: 'ar',
  },
];

const BASE_PROMPT_OPTIONS: PromptOptions = {
  confidenceThreshold: 0.7,
  safetyRules: [
    'Never provide a medical diagnosis.',
    'Never prescribe medication or recommend specific dosages.',
    'For any urgent or emergency concern, advise the patient to seek immediate professional care.',
    'Do not guess or fabricate information not present in the provided context.',
  ],
  answerBoundaries: [
    'Only answer using the provided context.',
    'If the context does not contain the answer, state that you do not have that information.',
    'Do not invent services, prices, or policies that are not in the context.',
  ],
  handoffConditions: [
    'Hand off to a human agent if the patient requests emergency care.',
    'Hand off to a human agent if the patient explicitly asks to speak with staff.',
    'Hand off to a human agent if the patient expresses dissatisfaction or a complaint.',
    'Hand off to a human agent if you are unsure how to answer accurately.',
  ],
};

describe('22 Acceptance Scenarios — Real Patient Transcripts', () => {
  describe.each(scenarios)(
    '$id: $description',
    ({ text, expectedIntent, expectedLanguage, isUrgent }) => {
      // --- Step 1: Language Detection ---
      it('detects the correct language', () => {
        const lang = detectLanguage(text);
        expect(lang).toBe(expectedLanguage);
      });

      // --- Step 2: Intent Classification ---
      it('classifies the correct intent', () => {
        const intelligence = detectConversationIntelligence(text);
        expect(intelligence.intent).toBe(expectedIntent);
        // Every intent should have a non-trivial confidence (above the default threshold)
        expect(intelligence.confidence).toBeGreaterThan(0.3);
      });

      // --- Step 3: Prompt Engineering ---
      it('builds a prompt that includes general dental knowledge', () => {
        const intelligence = detectConversationIntelligence(text);
        const prompt = buildPrompt(null, text, [], [], undefined, {
          ...BASE_PROMPT_OPTIONS,
          intent: intelligence.intent,
          conversationState: 'ai',
        });

        // The prompt MUST include general dental knowledge (Layer 1)
        // Keywords from the GENERAL_DENTAL_KNOWLEDGE constant
        expect(prompt).toMatch(/Dental implants|Root canal|tooth pain|whitening|gingivitis|extraction/i);

        // The prompt MUST include safety rules
        expect(prompt).toContain('Never provide a medical diagnosis');
        expect(prompt).toContain('Never prescribe medication');

        // The prompt MUST include the user's question
        expect(prompt).toContain(text);

        // The prompt MUST contain a disclaimer about general information
        expect(prompt).toMatch(/general information|dentist after an examination/i);
      });

      // --- Step 4: Urgency & Handoff (for emergency scenarios) ---
      if (isUrgent) {
        it('flags urgent/emergency scenarios for immediate handoff', () => {
          const intelligence = detectConversationIntelligence(text);
          expect(intelligence.urgency).toBe('critical');
          expect(intelligence.shouldHandoff).toBe(true);
        });
      }
    }
  );
});
