import { ClinicAISettings, Message } from '@/types/db';
import { RetrievalResult } from '@/lib/services/knowledge/retrieval';
import { ContextChunk, SourceCitation } from '@/lib/services/knowledge/contextAssembly';
import { detectLanguage } from '@/lib/services/knowledge/multilingual';
import { ConversationIntent, ConversationState } from '@/lib/ai/intelligence';

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
    clinicInfoSection,
    safetyRulesSection,
    answerBoundariesSection,
    handoffSection,
    intentSection,
    conversationStateSection,
    patientContextSection,
    citationInstructionsSection,
  ].filter(Boolean).join('\n\n');

  // Hallucination Prevention: If no relevant context is found, instruct the AI to admit it.
  if (!context.trim()) {
    let fallbackPrompt = `You are a helpful assistant with a dental clinic named {assistant_name}.
Your tone should be {tone}.
You must respond in {language}.

Use this information:
1. For any clinic-specific detail (appointments, prices, services, hours, location, insurance, policies), if you do NOT have it in context, say you don't have that information.
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
function buildClinicInfoSection(clinicInfo?: PromptOptions['clinicInfo']): string {
  if (!clinicInfo) return '';

  const lines: string[] = ['Clinic Information:'];
  if (clinicInfo.name) lines.push(`- Name: ${clinicInfo.name}`);
  if (clinicInfo.address) lines.push(`- Address: ${clinicInfo.address}`);
  if (clinicInfo.phone) lines.push(`- Phone: ${clinicInfo.phone}`);
  if (clinicInfo.website) lines.push(`- Website: ${clinicInfo.website}`);

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
 * Instructs the AI to cite sources in the specified format.
 */
function buildCitationInstructionsSection(): string {
  return `Source Citation Instructions:
- When referencing information from the context, cite the source using the format: [Source: filename, ID: document_id, Chunk: chunk_index]
- Do not fabricate sources or citations.
- If no relevant source is found, state that you don't have that information.`;
}
