import { ClinicAISettings, Message } from '@/types/db';
import { RetrievalResult } from '@/lib/services/knowledge/retrieval';
import { ContextChunk, SourceCitation } from '@/lib/services/knowledge/contextAssembly';
import { detectLanguage } from '@/lib/services/knowledge/multilingual';
import { ConversationIntent, ConversationState } from '@/lib/ai/intelligence';
import type { ClinicOperatingData } from '@/lib/ai/clinicDataContext';
import type { ReceptionistConversationState } from '@/lib/ai/clinicDataContext';

type HistoryMessage = Pick<Message, 'role' | 'content'>;

/**
 * Optional parameters for enhanced prompt building.
 * All fields are optional to maintain backward compatibility with
 * existing callers that use the 4-argument or 5-argument form.
 */
export interface PromptOptions {
  /** Clinic information to include in the prompt (name, address, phone, website). */
  clinicInfo?: {
    name?: string;
    address?: string;
    phone?: string;
    website?: string;
  };
  /** Medical safety rules to enforce (e.g. "never diagnose", "always recommend professional consultation"). */
  safetyRules?: string[];
  /** Answer boundary instructions (e.g. "only answer from context", "cite sources"). */
  answerBoundaries?: string[];
  /** Conditions under which a human handoff should be triggered. */
  handoffConditions?: string[];
  /** The detected conversation intent (e.g. 'appointment_booking', 'emergency'). */
  intent?: ConversationIntent;
  /** The current conversation state (e.g. 'ai', 'awaiting_staff', 'resolved'). */
  conversationState?: ConversationState;
  /** Confidence threshold below which the AI should refuse to answer. */
  confidenceThreshold?: number;
  /** Patient context extracted from the conversation (name, phone, email, requested service). */
  patientContext?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    requestedService?: string | null;
    preferredDate?: string | null;
    preferredTime?: string | null;
  };
  /**
   * Real clinic operating data (services + providers + assignments) read from
   * the DB. This is the SOURCE OF TRUTH for what the clinic offers. Present
   * even when the Knowledge Base is empty so the AI can recommend real
   * services/providers instead of answering "information unavailable".
   */
  operatingData?: ClinicOperatingData | null;
  /**
   * Serialized receptionist state (state machine stage, recommendation, what
   * booking info is still missing). Lets the AI ask ONLY the next missing
   * question and never repeat known information.
   */
  receptionistState?: ReceptionistConversationState | null;
}

/**
 * General dental knowledge embedded in ALL base prompts (Layer 1 — General
 * Conversational AI). This is educational, public-health information — NOT
 * clinic-specific. Patients can ask about any general dental topic (implants,
 * orthodontics, pain, crowns, bridges, root canal, extraction, whitening,
 * gum disease) and the AI answers confidently from this section.
 *
 * RAG remains ONLY for clinic-specific facts (prices, hours, services,
 * insurance, policies). The AI MUST state that general answers are education
 * and the final assessment is made by a dentist after an examination.
 */
const GENERAL_DENTAL_KNOWLEDGE = `General Dental Knowledge (educational public-health notes):
Use this for general dental questions. After answering, ALWAYS add a short note:
"This is general information — the final assessment and the decision are made by the dentist after an examination." (or equivalent in the response language).
Never give a definitive diagnosis, treatment promise, or specific medication/dosage.

- Dental implants (stents): surgical placement of a titanium post in the jawbone to replace a missing tooth. Candidates: healthy jawbone + healthy gum. Fusion/healing typically 3–6 months before the top tooth (crown) is attached.
- Tooth pain: common causes — deep decay, pulp irritation/infection (root canal areas), gum infection, impacted wisdom tooth, fractured tooth, sinus pressure in upper teeth. Sharp but brief pain with cold/hot/sweets often means reversible pulp sensitivity. Continuing throbbing pain (including at night), pain when chewing, facial swelling, fever, or bad taste = urgent — the patient should see a dentist immediately.
- Orthodontics (braces/aligners): corrects overcrowding/alignment/bite. Types: traditional metal, ceramic, clear aligner (Invisalign-style). Typical duration for orthodontics: 12-24 months (some longer), followed by a retainer. Adult treatment is common.
- Crown (cap): a cap-styled restoration that covers a damaged/deformed/deep-listed tooth (usual after root canal). Types: porcelain-fused-to-metal, all-ceramic/zirconia (most aesthetic), full-metal. The tooth is slightly shaved first, usually 2 visits.
- Bridge: replaces 1+ missing teeth by being cemented onto the two teeth adjacent to the gap. Unlike an implant (screwed in the bone), a bridge requires shaving the adjacent teeth. The right choice (implant or bridge) depends on bone and gum health and the adjacent teeth.
- Root canal (nerve treatment): removes infected/inflamed pulp, cleans and seals the inside of the tooth to save it from extraction. Usually 1-2 visits; the tooth becomes more brittle and frequently needs a crown afterward.
- Tooth extraction: the tooth is removed when decay/damage/loads are too severe or it is impacted. Aftercare: biting on gauze to stop bleeding, avoid rinsing/vigorous spitting/smoking/hot drinks for 24 hours, then gentle care (saline). Contact the dentist if bleeding continues or pain increases.
- Whitening: professional whitening lightens stained/discolored teeth. Temporary sensitivity is common. Whitening does NOT change the color of crowns, veneers, or fillings.
- Gum disease (gingivitis → periodontitis): starts with bleeding/tender red swollen gums; if untreated, destroys the supporting bone. Other signs: bad breath, gum recession, loose teeth. Prevention: keep 2×/day brushing, daily floss, clean scaling/polishing, don't smoke.
- Routine cleaning: detects/removes plaque, tartar/gingivitis; recommended every 6 months for many, but your dentist sets your interval.
- Emergencies: severe pain with swelling increasing, fever, difficulty swallowing/bowel tear, trauma to the jaw, unstoppable bleeding, or a knocked-out tooth ≥ urgent — the patient should go to a clinic/emergency immediately.

These are general educational points — they are NOT clinic-specific, prices, or this clinic's policies. Clinic hours, appointments, services, insurance, and real diagnosis must come from the provided Clinic Context, or the AI honestly says it doesn't have that information.`;

const DEFAULT_PROMPT_TEMPLATE = `You are a helpful AI assistant for a dental clinic. Your name is {assistant_name}.
Your tone should be {tone}.
You must respond in {language}.
GENDER-NEUTRAL ADDRESS (mandatory): the patient's gender is unknown. Address them neutrally — e.g. «يبدو أن لديك…», «هل يمكنك توضيح…», «أفهم أن هناك…». NEVER use gendered verb forms like «تواجهين», «ستجدين», «يمكنكِ», or any masculine/feminine form that assumes the patient's gender.

Use information this way:
1. For any clinic-specific detail (appointments, prices, services, hours, location, insurance, policies), answer ONLY from the Clinic Context below. If not in context, say you don't have that information.
2. For general dental-health questions (implants, orthodontics, tooth pain, gums, whitening, etc.), you may use the General Dental Knowledge section below, and always add the note that it is general information and the final assessment must be by a dentist after an examination.
3. Never invent or guess clinic facts.
Be concise and professional.

{history}

Clinic Context:
---
{context}
---

{general_dental_knowledge}

Question: {question}`;

/**
 * Builds a RAG prompt using a template, retrieved context, and user query.
 *
 * Features:
 * - Multilingual support: detects query language and sets the response language.
 * - Source citations: includes document filename, chunk ID, and confidence in context.
 * - Hallucination prevention: instructs the AI to only answer from provided context.
 * - Confidence thresholds: includes a confidence score for each context chunk.
 *
 * @param settings The clinic's AI settings.
 * @param question The user's original question.
 * @param history The recent conversation history.
 * @param rankedContext The ranked and filtered context chunks from the retrieval service.
 * @param citations Optional source citations for the context chunks.
 * @param options Optional enhanced prompt parameters (clinic info, safety rules, intent, etc.).
 * @returns The final prompt string.
 */
export function buildPrompt(
  settings: ClinicAISettings | null,
  question: string,
  history: HistoryMessage[],
  rankedContext: RetrievalResult[],
  citations?: SourceCitation[],
  options?: PromptOptions
): string {
  const assistantName = settings?.assistant_name || 'AI Assistant';
  const tone = settings?.tone || 'professional and friendly';

  // Multilingual: use the clinic's configured language, or fall back to the
  // original "the user's language" default. Language detection is used only
  // to add an advisory note — it must not replace the existing instruction.
  const detectedLang = detectLanguage(question);
  const language = settings?.language || 'the user\'s language';
  const languageNote = detectedLang === 'ar'
    ? "Note: The user's query is in Arabic. Please respond in Arabic."
    : detectedLang === 'en'
      ? "Note: The user's query is in English. Please respond in English."
      : '';

  // Build context string with source citations
  const context = rankedContext
    .map((chunk, index) => {
      const contextChunk = chunk as RetrievalResult & Partial<ContextChunk>;
      const citation = contextChunk.citation || citations?.[index];
      const content = contextChunk.content || citation?.content || '';
      const sourceInfo = citation
        ? `[Source: ${citation.filename}, ID: ${citation.documentId || 'N/A'}, Chunk: ${citation.chunkIndex ?? 'N/A'}]`
        : `[Source: ${chunk.document?.original_filename || 'knowledge base'}, ID: ${chunk.document_id || 'N/A'}, Chunk: ${chunk.chunk_index ?? 'N/A'}]`;
      const attribution = citation
        ? `[Document ID: ${citation.documentId || 'N/A'}, Chunk ID: ${citation.chunkId}${citation.pageNumber ? `, Page: ${citation.pageNumber}` : ''}]`
        : `[Document ID: ${chunk.document_id || 'N/A'}, Chunk ID: ${chunk.id}${chunk.page_number ? `, Page: ${chunk.page_number}` : ''}]`;
      // Confidence is appended as a separate line to preserve the citation format
      const confidenceLine = citation && citation.confidenceScore !== undefined
        ? `\nConfidence: ${citation.confidenceScore.toFixed(2)}`
        : '';
      return `${sourceInfo}${confidenceLine}\n${content}\n${attribution}`;
    })
    .join('\n\n');

  const historyString = history.length > 0
    ? 'Here is the recent conversation history:\n' + history.map(msg => `${msg.role === 'patient' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
    : '';

  // Build optional enhancement sections
  const clinicInfoSection = buildClinicInfoSection(options?.clinicInfo);
  const safetyRulesSection = buildSafetyRulesSection(options?.safetyRules);
  const answerBoundariesSection = buildAnswerBoundariesSection(options?.answerBoundaries);
  const handoffSection = buildHandoffSection(options?.handoffConditions);
  const intentSection = buildIntentSection(options?.intent);
  const conversationStateSection = buildConversationStateSection(options?.conversationState);
  const patientContextSection = buildPatientContextSection(options?.patientContext);
  const citationInstructionsSection = buildCitationInstructionsSection();

  // Combine all optional sections
  const optionalSections = [
    buildSourceSeparationSection(Boolean(context.trim())),
    clinicInfoSection,
    safetyRulesSection,
    answerBoundariesSection,
    handoffSection,
    intentSection,
    conversationStateSection,
    patientContextSection,
    buildOperatingDataSection(options?.operatingData),
    buildReceptionistModeSection(options?.receptionistState),
    citationInstructionsSection,
  ].filter(Boolean).join('\n\n');

  // Hallucination Prevention: If no relevant context is found, instruct the AI to admit it.
  if (!context.trim()) {
    let fallbackPrompt = `You are a helpful assistant with a dental clinic named {assistant_name}.
Your tone should be {tone}.
You must respond in {language}.
GENDER-NEUTRAL ADDRESS (mandatory): the patient's gender is unknown. Address them neutrally — e.g. «يبدو أن لديك…», «هل يمكنك توضيح…». NEVER use gendered verb forms like «تواجهين», «ستجدين», «يمكنكِ».

Use this information:
1. For any clinic-specific detail (services, providers, appointments, prices, hours, location, insurance, policies), use the Clinic Operating Data section when present (it is the source of truth from the clinic database). Only say you don't have that information when it is truly missing from both sections.
2. For general dental-health questions, you may use the General Dental Knowledge section below, and always add the note that it is general information and the final assessment must be by a dentist after an examination.
3. Never invent or guess clinic facts.

{history}

{general_dental_knowledge}

Question: {question}`;
    fallbackPrompt = fallbackPrompt.replace('{assistant_name}', assistantName);
    fallbackPrompt = fallbackPrompt.replace('{tone}', tone);
    fallbackPrompt = fallbackPrompt.replace('{language}', language);
    fallbackPrompt = fallbackPrompt.replace('{history}', historyString);
    fallbackPrompt = fallbackPrompt.replace('{general_dental_knowledge}', GENERAL_DENTAL_KNOWLEDGE);
    fallbackPrompt = fallbackPrompt.replace('{question}', question);

    // Append optional sections to fallback prompt if any exist
    if (optionalSections) {
      fallbackPrompt = `${fallbackPrompt}\n\n${optionalSections}`;
    }

    return fallbackPrompt;
  }

  let prompt = DEFAULT_PROMPT_TEMPLATE;
  prompt = prompt.replace('{assistant_name}', assistantName);
  prompt = prompt.replace('{tone}', tone);
  prompt = prompt.replace('{language}', language);
  prompt = prompt.replace('{history}', historyString);
  prompt = prompt.replace('{context}', context);
  prompt = prompt.replace('{general_dental_knowledge}', GENERAL_DENTAL_KNOWLEDGE);
  prompt = prompt.replace('{question}', question);

  // Append optional enhancement sections if any exist
  if (optionalSections) {
    prompt = `${prompt}\n\n${optionalSections}`;
  }

  return prompt;
}

/**
 * Builds the clinic information section for the prompt.
 * Only included when clinic info data is provided.
 */
/**
 * STEP 4 — Strict data-source separation & anti-hallucination directive.
 *
 * Tells the model the authoritative hierarchy of facts and that a low/high
 * confidence RAG hit is still a CLINIC-document source, never general
 * knowledge, and never a replacement for OperatingData.
 */
function buildSourceSeparationSection(hasContext: boolean): string {
  const ragLine = hasContext
    ? '- RAG / Clinic Knowledge: only what is quoted below with its [Source: …] and Confidence. Treat it as CLINIC documentation — never as general knowledge. If Confidence is below the threshold, you must NOT state it as a confirmed clinic fact; say it is not confirmed.'
    : '- RAG / Clinic Knowledge: none was retrieved for this turn. Do NOT pretend there is any clinic document; if a clinic-specific fact is missing, say it is not available.';
  return [
    'DATA SOURCE SEPARATION (mandatory — do not cross these boundaries):',
    '- ClinicFacts (name/address/phone/website): ONLY from the Clinic Information section. Never invent or infer them.',
    '- OperatingData (services/providers/assignments): ONLY from the Clinic Operating Data section. Never invent a service, doctor, or price.',
    ragLine,
    '- General Dental Knowledge: ONLY for educational answers about dentistry in general. Always add the note that it is general information and the final assessment is made by a dentist after an examination. NEVER present general knowledge as this clinic\'s policy/price/doctor/availability.',
    '- ConversationState: context about the CURRENT patient (their location, requested service, reported symptoms). It is never clinic fact. In particular, patient_location is about the PATIENT, not the clinic.',
    '- NEVER calculate availability, timezones, or slots yourself. Availability is provided ONLY by the real availability system (see REAL AVAILABILITY / booking notes). If none is provided, say availability needs confirmation.',
  ].join('\n');
}

function buildClinicInfoSection(clinicInfo?: PromptOptions['clinicInfo']): string {
  if (!clinicInfo) return '';

  const lines: string[] = ['Clinic Information: (authoritative facts from the clinic database)'];
  if (clinicInfo.name) lines.push(`- Name: ${clinicInfo.name}`);
  if (clinicInfo.address) lines.push(`- Address: ${clinicInfo.address}`);
  if (clinicInfo.phone) lines.push(`- Phone: ${clinicInfo.phone}`);
  if (clinicInfo.website) lines.push(`- Website: ${clinicInfo.website}`);
  lines.push('- These are the ONLY clinic facts you may state. If a field (name/address/phone/website) is ABSENT above, you do NOT have it — say so clearly. NEVER invent a clinic name/address/phone/website.');
  lines.push('- Use the clinic NAME exactly as written above — VERBATIM. Do NOT transliterate, rename, or invent an Arabic nickname for the clinic.');
  lines.push('- NEVER infer the clinic location from the patient\'s city/town. The clinic location is ONLY the one listed above (if any). If the patient asks "وين العيادة؟" and no address is listed, honestly say the address is not currently available.');

  if (lines.length === 1) return ''; // No actual info to show
  return lines.join('\n');
}

/**
 * Builds the medical safety rules section for the prompt.
 * Only included when safety rules are provided.
 */
function buildSafetyRulesSection(safetyRules?: string[]): string {
  if (!safetyRules || safetyRules.length === 0) return '';
  return `Medical Safety Rules:\n${safetyRules.map(rule => `- ${rule}`).join('\n')}`;
}

/**
 * Builds the answer boundaries section for the prompt.
 * Only included when answer boundary instructions are provided.
 */
function buildAnswerBoundariesSection(answerBoundaries?: string[]): string {
  if (!answerBoundaries || answerBoundaries.length === 0) return '';
  return `Answer Boundaries:\n${answerBoundaries.map(boundary => `- ${boundary}`).join('\n')}`;
}

/**
 * Builds the human handoff conditions section for the prompt.
 * Only included when handoff conditions are provided.
 */
function buildHandoffSection(handoffConditions?: string[]): string {
  if (!handoffConditions || handoffConditions.length === 0) return '';
  return `Human Handoff Rules:\n${handoffConditions.map(condition => `- ${condition}`).join('\n')}`;
}

/**
 * Builds the conversation intent section for the prompt.
 * Only included when an intent is provided.
 */
function buildIntentSection(intent?: ConversationIntent): string {
  if (!intent) return '';
  return `Conversation Intent: ${intent}`;
}

/**
 * Builds the conversation state section for the prompt.
 * Only included when a conversation state is provided.
 */
function buildConversationStateSection(conversationState?: ConversationState): string {
  if (!conversationState) return '';
  return `Conversation State: ${conversationState}`;
}

/**
 * Builds the patient context section for the prompt.
 * Only included when patient context data is provided.
 * Never includes sensitive data beyond what the patient already shared.
 */
function buildPatientContextSection(patientContext?: PromptOptions['patientContext']): string {
  if (!patientContext) return '';

  const lines: string[] = ['Patient Context:'];
  if (patientContext.name) lines.push(`- Name: ${patientContext.name}`);
  if (patientContext.requestedService) lines.push(`- Requested service: ${patientContext.requestedService}`);
  if (patientContext.preferredDate) lines.push(`- Preferred date: ${patientContext.preferredDate}`);
  if (patientContext.preferredTime) lines.push(`- Preferred time: ${patientContext.preferredTime}`);

  if (lines.length === 1) return ''; // No actual info to show
  return lines.join('\n');
}

/**
 * Builds the source citation instructions section for the prompt.
/**
 * Builds the clinic operating data section — the REAL services/providers the
 * clinic offers, straight from the DB (not the Knowledge Base). The AI must
 * treat this as the source of truth and never invent a service/provider.
 */
function buildOperatingDataSection(operatingData?: ClinicOperatingData | null): string {
  if (!operatingData || operatingData.services.length === 0) return '';

  const parts: string[] = ['Clinic Operating Data (source of truth from the clinic database):'];
  parts.push('Available services:');
  for (const s of operatingData.services) {
    const priceNote = describePriceForPrompt(s.id, operatingData);
    const providersForService = operatingData.providers.filter((p) =>
      operatingData.providerServiceIds.some((a) => a.service_id === s.id && a.provider_id === p.id)
    );
    const providerNames = providersForService.length > 0
      ? providersForService.map((p) => p.name).join('، ')
      : 'no assigned provider yet';
    parts.push(`- ${s.name}${s.description ? `: ${s.description}` : ''} (duration: ${s.duration_minutes} min)${priceNote}`);
    parts.push(`  Providers who provide it: ${providerNames}`);
  }
  if (operatingData.providers.length > 0) {
    parts.push('Clinic dentists/doctors:');
    for (const p of operatingData.providers) {
      parts.push(`- ${p.name}${p.title ? ` (${p.title})` : ''}`);
    }
  }
  parts.push('If the patient asks about a service NOT in this list, do not invent it and offer human help.');
  return parts.join('\n');
}

function describePriceForPrompt(serviceId: string, data: ClinicOperatingData): string {
  const s = data.services.find((x) => x.id === serviceId);
  if (!s) return '';
  if (s.price_visible_to_patients === false) return '';
  if (s.pricing_type === 'fixed' && s.price_min != null && Number(s.price_min) > 0) return `, price: ${s.price_min}`;
  if (s.pricing_type === 'range' && s.price_min != null && s.price_max != null && Number(s.price_min) > 0) return `, price range: ${s.price_min}–${s.price_max}`;
  if (s.pricing_type === 'estimate' && s.price_min != null && Number(s.price_min) > 0) return `, estimated price: approx ${s.price_min}`;
  if (s.pricing_type === 'case_by_case') return ', price: depends on the case (after the doctor’s examination)';
  return '';
} // unspecified → omitted; never "free"

/**
 * THE core receptionist behavioral section: open-ended natural Arabic
 * conversation driven by meaning, not keywords. The AI leads the dialogue,
 * asks only the NEXT missing question, recommends real DB resources, collects
 * the patient's name/phone in-conversation, and never fabricates anything.
 */
function buildReceptionistModeSection(receptionistState?: ReceptionistConversationState | null): string {
  if (!receptionistState) return '';

  const lines: string[] = ['RECEPTIONIST OPERATING MODE (follow strictly):'];
  lines.push('- Drive the conversation proactively. Understand the patient in ANY Arabic phrasing (colloquial or formal) from MEANING, not keyword matching. Talk naturally in Arabic (mirror the patient\'s style), keep replies short and warm.');
  lines.push('- Ask ONLY the single next missing question. Never ask again for something the patient already gave in this conversation.');
  lines.push(`- Current conversation stage: ${receptionistState.state}.`);
  if (receptionistState.recommended_service_id) {
    lines.push(`- Recommended service id: ${receptionistState.recommended_service_id}.`);
  }
  if (receptionistState.recommended_provider_id) {
    lines.push(`- Recommended provider id: ${receptionistState.recommended_provider_id} — only mention the provider NAME from Clinic Operating Data, never invent another doctor.`);
  }
  if (!receptionistState.recommended_provider_id) {
    lines.push('- Do NOT recommend or promise a specific doctor yet unless you have a real match in Clinic Operating Data.');
  }
  if (receptionistState.state === 'RECOMMENDING_PROVIDER') {
    lines.push('- You are proposing a specific real service/doctor. Present the matched service (from Operating Data) and the doctor (from Operating Data) and ask whether the patient wants to book it.');
  }
  if (receptionistState.state === 'DISCOVERING_PROBLEM' || !receptionistState.recommended_service_id) {
    lines.push('- The service/doctor is not known yet. Ask the patient which treatment/need they have and name the REAL services from Clinic Operating Data as examples (e.g. exam, cleaning, X-ray). Do NOT hand off or claim there is no availability just because the service is unspecified.');
  }
  if (receptionistState.state === 'AWAITING_BOOKING_CONFIRMATION') {
    lines.push('- The patient has a recommendation. Confirm the service + doctor and ask whether they want to book (one clear yes/no question).');
  }
  if (receptionistState.state === 'BOOKING') {
    lines.push('- Booking in progress. Collect missing details conversationally: patient full name, phone number, then preferred day/time. Confirm the slot before finalizing. When all details are known and the patient confirms, say the booking is complete and mention the scheduled day/time.');
  }
  if (receptionistState.booking_issue) {
    lines.push(`- Booking note for this turn: ${receptionistState.booking_issue}`);
  }
  if (receptionistState.specialty_guidance) {
    lines.push(
      `- Specialty guidance for this turn: the patient's request names "${receptionistState.specialty_guidance}" but THIS clinic has no such service in Clinic Operating Data. Do NOT invent a price, slot, or booking for it. Say its availability needs confirmation from the clinic reception, offer to take their contact details or hand off for exact pricing, and you may mention a matching specialist ONLY if one appears verbatim in Clinic Operating Data.`
    );
  }
  // STEP 5 — Network Discovery Mode: rendered ONLY when this turn's message
  // explicitly asked for other/nearby clinics. The guidance text is built from
  // the REAL clinic directory (never invented); absent → Clinic Reception Mode.
  if (receptionistState.discovery_guidance) {
    lines.push(`- ${receptionistState.discovery_guidance}.`);
    lines.push('- This clinic remains the default. These alternatives are listed ONLY because the patient explicitly asked; do not push the patient away, and keep serving this clinic unless they choose an alternative.');
  }
  // Phase 20 — booking memory: when this conversation already created a real
  // appointment, the AI can answer "موعدي متى؟" from REAL persisted data.
  if (receptionistState.booking?.appointment_id && receptionistState.booking?.scheduled_at) {
    lines.push(`- Existing booking in THIS conversation: appointment ${receptionistState.booking.appointment_id}, scheduled at ${receptionistState.booking.scheduled_at}${receptionistState.booking.appointment_status ? ` (status: ${receptionistState.booking.appointment_status})` : ''}. If the patient asks when their appointment is, answer with EXACTLY this day/time; do not invent another slot.`);
  }
  // A REAL slot resolved from the availability system (but not yet booked) — the
  // patient may follow up with "أي ساعة؟"/"بدي أقرب موعد". Present EXACTLY this.
  if (receptionistState.booking?.slot && !receptionistState.booking?.appointment_id) {
    lines.push(`- REAL proposed slot for this conversation (from the booking system): ${receptionistState.booking.slot}. When the patient asks about the time/date or says they want to book, present EXACTLY this day and time and ask for confirmation. NEVER invent another slot.`);
  }
  lines.push('- Pricing: never say free. If the price is not shown, say "السعر النهائي بيعتمد على حالتك وبعد فحص الطبيب".');
  lines.push('- Never invent: services, doctors, prices, policies, dates, diagnoses, distances. For "doctor near me" without reliable location data, invite the patient to share their area.');
  lines.push('- Emergency escalations (severe swelling, breathing/swallowing difficulty, heavy bleeding): advise immediate care and hand off to staff.');
  lines.push('- STRICT GROUNDING: State ONLY clinic facts that appear in Clinic Information / Operating Data. NEVER add descriptive words like "متميز", "خبير", "الأفضل", "الأشهر" unless they appear VERBATIM in clinic data. NEVER invent a clinic name/address/phone, doctors, titles, services, prices, policies, or dates.');
  lines.push('- LOCATION: NEVER infer the clinic location from the patient\'s city/area. If the patient says they live in a city, that is about THEM, not the clinic. The clinic location is ONLY the address in Clinic Information (if any); otherwise say it is not currently available.');
  lines.push('- REAL AVAILABILITY ONLY: NEVER invent a date or time for an appointment. If the booking note / REAL AVAILABILITY above provides a concrete slot, present exactly that day and time and ask for confirmation. If no real slot is provided, do NOT invent one — say availability needs to be confirmed and offer to hand off to the clinic reception.');
  lines.push('- PROVIDERS: only list doctors that appear in Clinic Operating Data, with exactly their recorded title. Do not invent credentials or specialties.');

  return lines.join('\n');
}
function buildCitationInstructionsSection(): string {
  return `Source Citation Instructions:
- When referencing information from the context, cite the source using the format: [Source: filename, ID: document_id, Chunk: chunk_index]
- Do not fabricate sources or citations.
- If no relevant source is found, state that you don't have that information.`;
}
