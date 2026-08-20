export const INTENTS = [
  'appointment_booking',
  'appointment_cancellation',
  'appointment_reschedule',
  'emergency',
  'pricing_inquiry',
  'insurance_inquiry',
  'services_inquiry',
  'clinic_hours',
  'location',
  'human_handoff',
  'patient_complaint',
  'general_question',
  'greeting',
  'goodbye',
  'unknown',
] as const;

export type ConversationIntent = (typeof INTENTS)[number];
export type LeadTemperature = 'hot' | 'warm' | 'cold';
export type ConversationState = 'ai' | 'awaiting_staff' | 'assigned_staff' | 'resolved' | 'closed';

export type AppointmentExtraction = {
  patientName: string | null;
  phone: string | null;
  email: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  requestedService: string | null;
};

export type ConversationIntelligence = {
  intent: ConversationIntent;
  confidence: number;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  lead: { temperature: LeadTemperature; confidence: number; estimatedValue: number };
  appointment: AppointmentExtraction;
  shouldHandoff: boolean;
  state: ConversationState;
};

type Rule = { intent: ConversationIntent; weight: number; terms: RegExp[] };

const RULES: Rule[] = [
  { intent: 'emergency', weight: 1, terms: [
    /emergency|urgent|severe pain|bleeding|swollen|trouble breathing|cannot breathe|swallowing/i,
    /طوارئ|عاجل|ألم شديد|نزيف|تورم|صعوبة بالتنفس|صعوبة بلع|سن مكسور|مش قادر اتنفس|انتفاخ كبير/i
  ]},
  { intent: 'appointment_cancellation', weight: 0.98, terms: [
    /cancel|cancellation|remove appointment/i,
    /إلغاء|الغاء|بطل الموعد|لغي|خلي الموعد/i
  ]},
  { intent: 'appointment_reschedule', weight: 0.96, terms: [
    /reschedule|change my appointment|move my appointment/i,
    /تأجيل|تغيير الموعد|تعديل الموعد|بدي غير موعدي|بدي اغير الموعد|ارحل الموعد|نقل الموعد/i
  ]},
  { intent: 'appointment_booking', weight: 0.9, terms: [
    /book|appointment|schedule|available slot/i,
    /حجز|موعد|احجز|ابدي احجز|بدي حجز|بدي موعد|اريد موعد|ريد موعد|عايز حجز|بدي دكتور|بدي اشوف دكتور/i
  ]},
  { intent: 'pricing_inquiry', weight: 0.82, terms: [
    /price|pricing|cost|how much|fee/i,
    /سعر|أسعار|تكلفة|كم السعر|قديش السعر|بش قد|كم بتبيع|شو الاسعار/i
  ]},
  { intent: 'insurance_inquiry', weight: 0.82, terms: [
    /insurance|insurer|ppo|coverage/i,
    /تأمين|شركة التأمين|تغطية|الضمان/i
  ]},
  { intent: 'patient_complaint', weight: 0.86, terms: [
    // English: pain, hurts, aching, toothache, broken tooth, sensitivity
    /pain|hurts|hurting|toothache|aching|sensitive|aching tooth|broken tooth|chip/i,
    // Arabic/Levantine: tooth/molar pain, cavities, broken tooth
    /بيجعني|بتجعني|بوجعني|بيوجعني|يعورني|بيرجع|وجع|ألم|يؤلم|بتالمني|تعبان|حساسية|سن خربان|خربان|مكسور|انكسر|انكسرت|طاحونة|ضرس|سني|سنه|بالتجوف|cavity/i
  ]},
  { intent: 'services_inquiry', weight: 0.78, terms: [
    /services|treatment|cleaning|root canal|implant|braces|whitening|orthodontist|filling/i,
    /خدمات|علاج|تنظيف|عصب|زراعة|تقويم|تبييض|حشوة|خلع|بدي ازرع|بدي اقلع|بدي اعالج|شو عندكم|عندكم/i
  ]},
  { intent: 'clinic_hours', weight: 0.76, terms: [
    /hours|open|opening|closing|when are you/i,
    /ساعات|مواعيد العمل|مفتوح|يفتح|يغلق|متى بتفتح|متى بتقفل|بطول الدوام|اوقات الدوام|اوقات العمل/i
  ]},
  { intent: 'location', weight: 0.76, terms: [
    /where|location|address|directions/i,
    /أين|الموقع|العنوان|اتجاهات|وينكم|وين العيادة|شو عنوانكم/i
  ]},
  { intent: 'human_handoff', weight: 1, terms: [
    /human|agent|staff|representative|call me/i,
    /موظف|موظفين|بشر|اتصل بي|خدمة العملاء|بدي احكي مع موظفة|بدي احكي مع موظف|بدي احكي مع الدكتور|بدي حدا من العيادة|مش فاهم|عايز اتكلم مع حد/i
  ]},
  { intent: 'general_question', weight: 0.5, terms: [
    /what is|what's|why|could you|tell me|how do|explain/i,
    /شو|ليش|ازاي|كيف|مين|عرفني|اشرح|يعني ايه|شو الفرق|ما هو|ما هي|هل|ممكن شرح/i
  ]},
  { intent: 'greeting', weight: 0.45, terms: [
    /hi|hello|good morning|good evening|hey/i,
    /مرحبا|اهلا|اهلين|صباح الخير|مساء الخير|هاي|هلا|يامرحبا/i
  ]},
  { intent: 'goodbye', weight: 0.45, terms: [
    /bye|goodbye|see you|later/i,
    /باي|مع السلامة|في امان الله|وداعا|يسلمو|شكرا|thanks/i
  ]},
];

function firstMatch(text: string, expressions: RegExp[]) {
  return expressions.find((expression) => expression.test(text)) ?? null;
}

function extractAppointment(text: string): AppointmentExtraction {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g)?.map((candidate) => candidate.trim()).find((candidate) => !/^20\d{2}[-/]\d{1,2}[-/]\d{1,2}$/.test(candidate) && !/^\d{1,2}[-/]\d{1,2}[-/]20\d{2}$/.test(candidate)) ?? null;
  const date = text.match(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/)?.[0] ?? null;
  const time = text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\s?(?:am|pm)?\b|\b(?:1[0-2]|0?[1-9])\s?(?:am|pm)\b/i)?.[0] ?? null;
  const name = text.match(/(?:my name is|i am|this is|اسمي|أنا)\s+([^,.\n]{2,60})/i)?.[1]?.trim() ?? null;
  const service = text.match(/(?:for|need|service|لـ|اريد|أريد)\s+(?:to\s+book\s+)?(?:an?\s+)?([^,.\n]{2,40}?)(?=\s+(?:on|at|my|and|يوم|بتاريخ|الساعة)|[,.]|$)/i)?.[1]?.trim()
    ?? text.match(/\bbook\s+(?:an?\s+)?([^,.\n]{2,40}?)(?=\s+(?:on|at|my|and)|[,.]|$)/i)?.[1]?.trim()
    ?? null;

  return { patientName: name, phone, email, preferredDate: date, preferredTime: time, requestedService: service };
}

export function detectConversationIntelligence(text: string, threshold = 0.65): ConversationIntelligence {
  const normalized = text.trim();
  const matches = RULES.map((rule) => ({ rule, match: firstMatch(normalized, rule.terms) })).filter((item) => item.match);
  const best = matches.sort((a, b) => b.rule.weight - a.rule.weight)[0];
  const intent = best?.rule.intent ?? 'unknown';
  const confidence = best ? Math.min(0.99, best.rule.weight + (matches.length > 1 ? 0.03 : 0)) : 0.2;
  const appointment = extractAppointment(normalized);
  const urgent = intent === 'emergency';
  const hasContact = Boolean(appointment.phone || appointment.email);
  const isBooking = intent === 'appointment_booking' || intent === 'appointment_reschedule';
  const leadConfidence = Math.min(0.99, (isBooking ? 0.65 : 0) + (hasContact ? 0.2 : 0) + (urgent ? 0.15 : 0));
  const temperature: LeadTemperature = urgent || (isBooking && hasContact) ? 'hot' : isBooking || hasContact || intent === 'pricing_inquiry' ? 'warm' : 'cold';
  const urgency = urgent ? 'critical' : intent === 'human_handoff' ? 'high' : isBooking ? 'normal' : 'low';
  // Hand off only when the patient EXPLICITLY asks for staff/emergency,
  // or when a matched intent (not unknown) has low confidence.
  // Unknown/greeting intents should let the AI answer normally.
  // Hand off on explicit human requests / urgent signals, or low-confidence
  // matched intents that are NOT conversational (greeting/general/unknown/complaint).
  const conversationalIntents = ['greeting', 'general_question', 'patient_complaint', 'unknown', 'goodbye'];
  const shouldHandoff = intent === 'human_handoff' || urgent || (!conversationalIntents.includes(intent) && confidence < threshold);

  return {
    intent,
    confidence,
    urgency,
    lead: { temperature, confidence: leadConfidence, estimatedValue: temperature === 'hot' ? 1200 : temperature === 'warm' ? 500 : 0 },
    appointment,
    shouldHandoff,
    state: shouldHandoff ? 'awaiting_staff' : 'ai',
  };
}
