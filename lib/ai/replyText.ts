/**
 * Deterministic reply text used by the orchestrator's non-LLM paths.
 *
 * ROOT-CAUSE FIX (product behavior):
 *  - The old hard-coded Arabic fallback addressed the patient with the FEMININE
 *    form «موظفة الاستقبال» and gave a dead-end answer. Staff gender ≠ patient
 *    address: replies must stay GENDER-NEUTRAL and actionable.
 *  - A treatment request ("بدي اعمل تقويم") must NEVER hit this dead-end just
 *    because RAG confidence was low or the clinic operating snapshot failed to
 *    load. expressesTreatmentDesire() is a pure SAFETY-NET (not the primary
 *    NLP) that bypasses the dead-end so the LLM path can handle the intent
 *    semantically with real clinic data or a safe general answer.
 */

export type ReplyLang = 'ar' | 'en';

/** Honest dead-end reply — gender-neutral, offers concrete next steps only. */
export function unavailableReply(lang: ReplyLang): string {
  return lang === 'ar'
    ? 'هذه المعلومة غير متوفرة لدي حاليًا. يمكنني مساعدتك في حجز موعد، أو أحوّل طلبك إلى فريق الاستقبال لمتابعته معك.'
    : "This information isn't available right now. I can help you book an appointment, or forward your request to our reception team.";
}

const DESIRE_MARKERS =
  '(?:بدي|أبغي|ابغي|أريد|اريد|نفسي|حابب|حاب|ودي|أبي|ابي|ممكن|لو سمحت|i want|want to|need|looking for|would like)';
const TREATMENT_OR_BOOKING =
  '(?:تقويم|حشو|خلع|تنظيف|تبييض|زراعة|جسر|طربوش|تركيب|فحص|أشعة|اشعة|جلدة|عصب|موعد|احجز|أحجز|braces|orthodontics|filling|extraction|cleaning|whitening|implant|appointment|book)';

/**
 * Pure safety-net: does the message express wanting a treatment/booking?
 * Deliberately narrow (desire marker AND treatment word) so ordinary fact
 * questions like "شو أسعار التنظيف؟" still get the honest path when data is
 * truly missing.
 */
export function expressesTreatmentDesire(text: string): boolean {
  const normalized = text.toLowerCase();
  const desire = new RegExp(`${DESIRE_MARKERS}`, 'i');
  const treatment = new RegExp(TREATMENT_OR_BOOKING, 'i');
  return desire.test(normalized) && treatment.test(normalized);
}
