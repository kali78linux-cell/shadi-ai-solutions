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
  { intent: 'emergency', weight: 1, terms: [/emergency|urgent|severe pain|bleeding|swollen|broken tooth/i, /طوارئ|عاجل|ألم شديد|نزيف|تورم|سن مكسور/i] },
  { intent: 'appointment_cancellation', weight: 0.98, terms: [/cancel|cancellation/i, /إلغاء|الغاء/i] },
  { intent: 'appointment_reschedule', weight: 0.96, terms: [/reschedule|change my appointment|move my appointment/i, /تأجيل|تغيير الموعد|تعديل الموعد/i] },
  { intent: 'appointment_booking', weight: 0.9, terms: [/book|appointment|schedule|available slot/i, /حجز|موعد|احجز|متاح/i] },
  { intent: 'pricing_inquiry', weight: 0.82, terms: [/price|pricing|cost|how much|fee/i, /سعر|أسعار|تكلفة|كم السعر/i] },
  { intent: 'insurance_inquiry', weight: 0.82, terms: [/insurance|insurer|ppo|coverage/i, /تأمين|شركة التأمين|تغطية/i] },
  { intent: 'services_inquiry', weight: 0.78, terms: [/services|treatment|cleaning|root canal|implant/i, /خدمات|علاج|تنظيف|عصب|زراعة/i] },
  { intent: 'clinic_hours', weight: 0.76, terms: [/hours|open|opening|closing|when are you/i, /ساعات|مواعيد العمل|مفتوح|يفتح|يغلق/i] },
  { intent: 'location', weight: 0.76, terms: [/where|location|address|directions/i, /أين|الموقع|العنوان|اتجاهات/i] },
  { intent: 'human_handoff', weight: 1, terms: [/human|agent|staff|representative|call me/i, /موظف|موظفين|بشر|اتصل بي|خدمة العملاء/i] },
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
  const shouldHandoff = intent === 'human_handoff' || urgent || confidence < threshold;

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
