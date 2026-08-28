import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getProvider } from './provider';
import { ensureAIProviders } from './providers/registry';
import { retrieveContext, clearRetrievalCache } from './contextRetrieval';
import { buildPrompt } from './promptManager';
import { analyzeAndPersistMessage } from '@/lib/services/conversationIntelligence';
import { getConversationHistory } from '@/lib/services/messageService';
import { updateConversationState } from '@/lib/services/conversationService';
import { notifyStaffForHandoff } from '@/lib/services/notificationService';
import { calculateCost } from '@/lib/services/aiCostService';
import { moderateUserPrompt, ContentFlaggedError } from './security';
import { detectLanguage } from '@/lib/services/knowledge/multilingual';
import { estimateTokenCount } from '@/lib/services/knowledge/contextAssembly';
import type { Message } from '@/types/db';
import type { AssembledContext, SourceCitation } from '@/lib/services/knowledge/contextAssembly';
import type { RetrievalResult } from '@/lib/services/knowledge/retrieval';
import {
  loadClinicOperatingData,
  loadReceptionistConversationState,
  loadClinicProfile,
  persistReceptionistSlot,
  OPERATIVE_CONVERSATION_INTENTS,
  type ReceptionistConversationState,
  type ClinicProfile,
} from '@/lib/ai/clinicDataContext';
import { attemptConversationBooking } from '@/lib/ai/conversationBooking';
import { findEarliestAvailableSlot, resolveServiceByName, resolveProviderByName } from '@/lib/ai/availabilityTool';
import { understandMessage, applyUnderstandingToState } from '@/lib/ai/understanding';
import { saveConversationContext, type ConversationContext } from '@/lib/ai/conversationContext';
import { buildDiscoveryGuidance } from '@/lib/ai/discoveryGuidance';
import { unavailableReply, expressesTreatmentDesire } from '@/lib/ai/replyText';
import { persistHandoffReply } from '@/lib/ai/handoffMessages';
import { generateWithFailover } from '@/lib/ai/resilience';

type HistoryMessage = Pick<Message, 'role' | 'content'>;

/**
 * Registers the active AI provider based on the AI_PROVIDER environment variable.
 * - AI_PROVIDER=ollama → Ollama (local, zero-cost)
 * - AI_PROVIDER=openai or unset → OpenAI (cloud, production)
 * Both providers are registered so getProvider() falls back correctly.
 */
ensureAIProviders();

/**
 * Confidence threshold below which the AI should refuse to answer
 * and fall back to a safe response.
 */
const HALLUCINATION_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Maximum context tokens to pass to the AI model.
 */
const MAX_CONTEXT_TOKENS = 2000;

/**
 * Maximum conversation history tokens to include in the prompt.
 */
const MAX_HISTORY_TOKENS = 1000;

/**
 * Maps the authoritative clinic profile to the prompt's clinicInfo shape.
 * Prefers the real profile from the `clinics` table (source of truth) and
 * never falls back to invented values.
 */
function buildClinicInfo(profile?: ClinicProfile | null): {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
} {
  if (!profile || !profile.hasProfile) return {};
  const info: { name?: string; address?: string; phone?: string; website?: string } = {};
  if (profile.name) info.name = profile.name;
  if (profile.address) info.address = profile.address;
  if (profile.phone) info.phone = profile.phone;
  if (profile.website) info.website = profile.website;
  return info;
}

/**
 * Summarizes conversation history to fit within token limits.
 * If the history is too long, it summarizes older messages.
 *
 * @param history The conversation history messages.
 * @param maxTokens The maximum number of tokens to allow.
 * @returns A trimmed/summarized history array.
 */
function summarizeHistory(history: HistoryMessage[], maxTokens: number): HistoryMessage[] {
  if (!history || history.length === 0) return [];

  let totalTokens = 0;
  const trimmed: HistoryMessage[] = [];

  // Iterate from newest to oldest, keeping messages until we hit the token limit
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgTokens = estimateTokenCount(msg.content);
    if (totalTokens + msgTokens > maxTokens) {
      // If this message alone exceeds the limit, summarize it
      if (msgTokens > maxTokens) {
        trimmed.unshift({
          role: msg.role,
          content: msg.content.slice(0, Math.floor(maxTokens * 4)).trim() + '... [truncated]',
        });
      }
      break;
    }
    totalTokens += msgTokens;
    trimmed.unshift(msg);
  }

  return trimmed;
}

/**
 * Checks if the conversation has already addressed a similar question
 * to avoid asking the user to repeat themselves.
 *
 * @param history The conversation history.
 * @param currentQuestion The current user question.
 * @returns True if a similar question was recently asked.
 */
function hasRecentSimilarQuestion(history: HistoryMessage[], currentQuestion: string): boolean {
  if (!history || history.length === 0) return false;

  const recentQuestions = history
    .filter((msg) => msg.role === 'patient')
    .slice(-3) // Check last 3 patient messages
    .map((msg) => msg.content.toLowerCase().trim());

  const current = currentQuestion.toLowerCase().trim();

  return recentQuestions.some((q) => {
    // Simple similarity: check if questions share significant overlap
    const currentWords = new Set(current.split(/\s+/).filter((w) => w.length > 3));
    const questionWords = new Set(q.split(/\s+/).filter((w) => w.length > 3));
    if (currentWords.size === 0 || questionWords.size === 0) return false;

    let overlap = 0;
    for (const word of Array.from(currentWords)) {
      if (questionWords.has(word)) overlap++;
    }
    const similarity = overlap / Math.max(currentWords.size, questionWords.size);
    return similarity > 0.5;
  });
}

export async function handleIncomingMessage(opts: {
  clinicId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  text: string;
  modelPreference?: string | null;
}) {
  const { clinicId, conversationId, sessionId, userId, text, modelPreference } = opts;

  logEvent('ai_request_started', { clinic_id: clinicId, conversation_id: conversationId, session_id: sessionId, user_id: userId, provider: modelPreference || undefined });

  if (!getProvider()) {
    throw new Error('AI runtime is not configured. Please register an AI provider.');
  }

  if (!conversationId) {
    logEvent('ai_request_failed', { clinic_id: clinicId, session_id: sessionId, user_id: userId, error: 'conversationId is required for AI conversation intelligence' }, 'error');
    throw new Error('conversationId is required for AI conversation intelligence');
  }

  try {
    // Persist incoming message
    const { data: userMsg, error: userMsgError } = await supabaseAdmin.from('messages').insert([
      {
        conversation_id: conversationId,
        clinic_id: clinicId,
        role: 'patient',
        sender_id: userId,
        content: text,
      },
    ]).select('*').single();
    if (userMsgError) throw userMsgError;

    // Retrieve clinic settings and context
    const { data: settingsData } = await supabaseAdmin.from('clinic_ai_settings').select('*').eq('clinic_id', clinicId).limit(1).single();
    const intelligence = await analyzeAndPersistMessage(supabaseAdmin, {
      clinicId,
      conversationId,
      text,
      confidenceThreshold: Number(settingsData?.confidence_threshold ?? settingsData?.safety_controls?.confidence_threshold ?? 0.65),
    });

    // --- Handoff Integrity Check ---
    if (intelligence.shouldHandoff) {
      await updateConversationState(conversationId, 'awaiting_staff', clinicId);
      await notifyStaffForHandoff(clinicId, conversationId);
      logEvent('ai_handoff_triggered', { clinic_id: clinicId, conversation_id: conversationId, reason: intelligence.intent });
      // P0 FIX: the patient must ALWAYS receive a reply. Emergencies get
      // explicit urgent-care instructions; human-handoff requests get an
      // acknowledgment. The reply is persisted so the transcript matches.
      const handoffReply = await persistHandoffReply({
        supabase: supabaseAdmin,
        clinicId,
        conversationId,
        intent: intelligence.intent,
      });
      return {
        userMessage: userMsg,
        assistantMessage: {
          id: handoffReply.persistedId ?? '',
          conversation_id: conversationId,
          clinic_id: clinicId,
          role: 'assistant' as const,
          content: handoffReply.content,
          created_at: new Date().toISOString(),
          metadata: { handoff: true, emergency: handoffReply.emergency },
        },
        citations: [],
      };
    }

    // --- Conversational Memory & Context ---
    // Security: Moderate user input before processing
    try {
      await moderateUserPrompt(text);
    } catch (error) {
      if (error instanceof ContentFlaggedError) {
        // Stop processing if content is flagged, but don't crash.
        return null;
      }
    }

    // --- Clinic Operating Data (source of truth, scoped to THIS clinic) ---
    // Read the actual services/providers/assignments offered by this clinic so
    // the AI can recommend/correct/complete bookings even when the Knowledge
    // Base is empty. Cross-clinic leakage is impossible: every query is
    // filtered by clinic_id.
    const operatingData = await loadClinicOperatingData(clinicId);
    const receptionState = await loadReceptionistConversationState(clinicId, conversationId);
    // Authoritative clinic identity/profile from the `clinics` table. This is
    // the ONLY source of the clinic's real name/address/phone — never inferred
    // from the patient's location or invented by the model.
    const clinicProfile = await loadClinicProfile(clinicId);

    // ─── STEP 2→3 bridge: understand this message, merge into the reception
    //     state, persist incrementally, and resolve names → REAL ids. ───
    let currentState = receptionState;
    // STEP 5 — discovery intent is PER-TURN: only this message's explicit ask
    // ("وين عيادة ثانية؟") triggers Network Discovery Mode. The persisted
    // network_discovery_agreed flag stays as history but never re-triggers
    // clinic lists on later unrelated turns.
    let turnDiscoveryAgreed: boolean | null = null;
    if (currentState) {
      const understanding = understandMessage(text, {
        now: new Date(),
        timeZone: clinicProfile?.timezone ?? undefined,
      });
      turnDiscoveryAgreed = understanding.network_discovery_agreed ?? null;
      currentState = applyUnderstandingToState(currentState, understanding);
      if (Object.keys(understanding).length > 0) {
        await saveConversationContext(clinicId, conversationId, understanding as unknown as ConversationContext);
      }
      // Resolve requested names against THIS clinic's real operating data.
      // null = no match or ambiguous → the assistant asks for clarification.
      if (!currentState.recommended_service_id && currentState.requested_service) {
        const svc = resolveServiceByName(currentState.requested_service, operatingData);
        if (svc) currentState.recommended_service_id = svc.id;
      }
      if (!currentState.recommended_provider_id && currentState.preferred_provider) {
        const prov = resolveProviderByName(currentState.preferred_provider, operatingData);
        if (prov) currentState.recommended_provider_id = prov.id;
      }
    }

    // --- REAL availability resolution (grounded booking) ---
    // When the patient is booking and the deterministic service + provider are
    // known, resolve the EARLIEST real slot from the scheduling engine and
    // persist it so the AI presents an actual date/time (never invented) and
    // the booking can complete. Follow-up turns ("أي ساعة؟", confirmation)
    // reuse the persisted slot. Failures degrade to a structured NOT_AVAILABLE
    // note — never "AI unavailable".
    let availabilityNote: string | null = null;
    const needsRealSlot =
      intelligence.intent === 'appointment_booking' &&
      currentState &&
      currentState.recommended_service_id &&
      currentState.recommended_provider_id &&
      !currentState.booking.slot &&
      currentState.state !== 'BOOKING' &&
      currentState.state !== 'COMPLETED';

    if (needsRealSlot) {
      try {
        const availability = await findEarliestAvailableSlot({
          clinicId,
          providerId: currentState!.recommended_provider_id as string,
          serviceId: currentState!.recommended_service_id as string,
          preferredDate: currentState!.preferred_date ?? undefined,
          preferredTimeRange: currentState!.preferred_time_range ?? undefined,
          preferredTimeOptions: currentState!.preferred_time_options ?? undefined,
          timeZone: clinicProfile?.timezone ?? undefined,
        });
        if (availability.found) {
          await persistReceptionistSlot(clinicId, conversationId, {
            slot: availability.slot,
            slot_start: availability.slotStart ?? availability.slot,
            slot_end: availability.slotEnd ?? availability.slot,
            provider_id: availability.providerId,
            service_id: availability.serviceId,
          });
          if (currentState) {
            currentState.booking.slot = availability.slot;
          }
          availabilityNote =
            `REAL AVAILABILITY (queried from the booking system — NEVER invent any other slot): ` +
            `the earliest available slot is ${availability.date} at ${availability.time} with the recommended provider. ` +
            `Present this exact day/time to the patient and ask for confirmation to book it. ` +
            `Do NOT offer any other time or date.`;
          logEvent('receptionist_real_slot_resolved', {
            clinic_id: clinicId,
            conversation_id: conversationId,
            slot: availability.slot,
            provider_id: availability.providerId,
          });
        } else {
          availabilityNote =
            `REAL AVAILABILITY check found no available slot for the recommended provider in the near future. ` +
            `Do NOT invent a date/time. Tell the patient that availability needs to be confirmed and offer to hand off to the clinic reception.`;
          logEvent('receptionist_real_slot_empty', {
            clinic_id: clinicId,
            conversation_id: conversationId,
            reason: availability.reason,
            message: availability.message ?? null,
          });
        }
      } catch (err) {
        logEvent('receptionist_real_slot_error', {
          clinic_id: clinicId,
          conversation_id: conversationId,
          error: err instanceof Error ? err.message : String(err),
        }, 'error');
        availabilityNote =
          `The availability system is temporarily unavailable. Do NOT invent a date/time; ` +
          `tell the patient we could not retrieve slots right now and offer human help.`;
      }
    }

    // --- Conversational booking execution ---
    // When the state machine reached BOOKING and the patient explicitly
    // confirmed, try to complete the booking INSIDE the conversation using the
    // existing, concurrency-safe `createBooking`. Results are passed to the
    // LLM as an instruction note so the reply stays natural.
    let bookingNote: string | null = null;
    if (receptionState?.state === 'BOOKING' && receptionState.patient_confirmed_booking) {
      // Carry any patient name/phone/email collected in THIS turn into the
      // booking state so the patient doesn't have to repeat it and the booking
      // can complete. Persisted so later turns keep it too.
      const ap = intelligence.appointment;
      if (ap?.patientName && !receptionState.booking.patient_name) receptionState.booking.patient_name = ap.patientName;
      if (ap?.phone && !receptionState.booking.phone) receptionState.booking.phone = ap.phone;
      if (ap?.email && !receptionState.booking.email) receptionState.booking.email = ap.email;
      const hasCollected = Boolean(ap?.patientName || ap?.phone || ap?.email);
      if (hasCollected) {
        await persistReceptionistSlot(clinicId, conversationId, {
          patient_name: receptionState.booking.patient_name,
          phone: receptionState.booking.phone,
          email: receptionState.booking.email,
        });
      }
      const attempt = await attemptConversationBooking({
        clinicId,
        conversationId,
        state: receptionState.state,
        patientConfirmedBooking: receptionState.patient_confirmed_booking,
        booking: receptionState.booking,
        operatingData,
      });
      if (attempt.action === 'booked') {
        bookingNote = `Booking confirmed for this conversation (appointment ${attempt.appointment.id}, scheduled ${attempt.appointment.scheduled_at}). Reply with a warm Arabic confirmation that mentions the scheduled day and time.`;
      } else if (attempt.action === 'already_booked') {
        bookingNote = `This conversation already has a booking (appointment ${attempt.appointment_id}). Reply confirming it warmly.`;
      } else if (attempt.action === 'need_more_info') {
        bookingNote = `Booking in progress. Still missing: ${attempt.missing.join(', ')}. Ask for exactly these details, one at a time.`;
      } else if (attempt.action === 'slot_unavailable') {
        bookingNote = 'The requested slot is no longer available. Apologize and invite the patient to choose another day or time (do not confirm a booking).';
      } else if (attempt.action === 'failed') {
        bookingNote = 'A system issue prevented completing the booking. Do not confirm — offer human help instead.';
      }
    }
    // STEP 5 — Network Discovery Mode: computed ONLY when the patient
    // explicitly asked for alternatives. Prompt-only (never persisted).
    const discoveryGuidance = await buildDiscoveryGuidance({
      // Per-turn intent ONLY («وين عيادة ثانية؟» in THIS message). The persisted
      // flag stays as history and must never re-trigger clinic lists later.
      agreed: turnDiscoveryAgreed,
      patientCity: currentState?.patient_location?.city ?? null,
      requestedService: currentState?.requested_service ?? null,
      currentClinicName: clinicProfile?.name ?? null,
    });
    const promptReceptionState: ReceptionistConversationState | null = currentState
      ? {
          ...currentState,
          booking_issue: [bookingNote, availabilityNote].filter(Boolean).join('\n') || null,
          specialty_guidance: currentState.specialty_guidance ?? null,
          discovery_guidance: discoveryGuidance,
        }
      : null;

    // Retrieve conversation history and summarize if needed
    const rawHistory = await getConversationHistory(conversationId, 10);
    const history = summarizeHistory(rawHistory, MAX_HISTORY_TOKENS);

    // Check for repeated questions
    if (hasRecentSimilarQuestion(rawHistory, text)) {
      logEvent('repeated_question_detected', { clinic_id: clinicId, conversation_id: conversationId });
    }

    // --- Retrieval-Augmented Generation ---
    // Retrieve relevant context from the knowledge base.
    // retrieveContext may return either a legacy array of RetrievalResult
    // (backward-compatible callers) or a full AssembledContext object.
    const configuredConfidenceThreshold = Number(
      settingsData?.confidence_threshold ?? settingsData?.safety_controls?.confidence_threshold ?? HALLUCINATION_CONFIDENCE_THRESHOLD
    );
    const retrieved = await retrieveContext(clinicId, text, 5, MAX_CONTEXT_TOKENS, configuredConfidenceThreshold);
    // When the active provider has no embedding support (e.g. local Ollama),
    // keyword-only retrieval scores are naturally lower, so lower the
    // effective threshold to match contextRetrieval's behavior.
    const effectiveConfidenceThreshold = getProvider()?.embed
      ? configuredConfidenceThreshold
      : Math.min(configuredConfidenceThreshold, 0.45);

    // Normalize the return value into a consistent shape.
    let contextForPrompt: RetrievalResult[];
    let citations: SourceCitation[] = [];
    let contextTokens = 0;
    let contextTruncated = false;

    if (Array.isArray(retrieved)) {
      // Legacy: plain array of RetrievalResult
      contextForPrompt = retrieved;
    } else {
      // New: AssembledContext with chunks, citations, and metadata
      contextForPrompt = retrieved.chunks?.map((chunk) => chunk.result || {
        id: chunk.citation.chunkId,
        document_id: chunk.citation.documentId,
        chunk_index: chunk.citation.chunkIndex,
        content: chunk.content,
        similarity: chunk.citation.confidenceScore,
        confidenceScore: chunk.citation.confidenceScore,
        type: 'unstructured',
      }) || [];
      citations = retrieved.citations || [];
      contextTokens = retrieved.totalTokens || 0;
      contextTruncated = retrieved.truncated || false;
    }

    // --- Hallucination Prevention ---
    // Check if we have sufficient confidence in the retrieved context
    const maxConfidence = citations.length > 0
      ? Math.max(...citations.map((citation) => citation.confidenceScore))
      : contextForPrompt.length > 0
        ? Math.max(...contextForPrompt.map((chunk) => chunk.confidenceScore ?? chunk.rankingScore ?? chunk.similarity ?? 0))
        : 0;

    const isAssembledContext = !Array.isArray(retrieved);
    const hasSufficientContext = !isAssembledContext || (
      maxConfidence >= effectiveConfidenceThreshold &&
      !(retrieved as AssembledContext).hasConflictingContext
    );

    if (!hasSufficientContext) {
      // RAG failed/insufficient. But NOT every message needs RAG.
      // Clinic-specific intents (pricing, services, location, hours, insurance) MUST NOT
      // guess without knowledge. General/unknown/complaint/greeting intents should
      // proceed to the LLM with a context-absence note (the LLM decides what to answer).
      const clinicSpecificIntent = ['pricing_inquiry', 'insurance_inquiry', 'services_inquiry', 'clinic_hours', 'location', 'appointment_booking', 'appointment_cancellation', 'appointment_reschedule'].includes(intelligence.intent);
      const lowConfidence = maxConfidence < effectiveConfidenceThreshold;
      // An empty Knowledge Base must NOT short-circuit a conversation. Operative
      // intents (booking, complaints, questions) always proceed to the LLM, and
      // service/provider inquiries can be answered from the DB operating data.
      // Only genuinely clinic-specific fact inquiries with NO KB and NO operating
      // data fall back to the honest "unavailable" template.
      const operativeIntent = OPERATIVE_CONVERSATION_INTENTS.has(intelligence.intent);
      // SAFETY-NET (not primary NLP): a concrete treatment/booking desire must
      // NEVER dead-end in the honest-unavailable template just because RAG
      // confidence was low or the operating-data snapshot failed to load.
      // The LLM path handles it semantically with real clinic data or a safe
      // general answer — product rule: «بدي اعمل تقويم» ≠ «غير متوفرة».
      const treatmentDesire = expressesTreatmentDesire(text);

      if (clinicSpecificIntent && lowConfidence && !operativeIntent && !operatingData.usable && !treatmentDesire) {
        // Explicit "I don't know" for clinic facts — gender-neutral + actionable.
        const unavailableResponse = unavailableReply(detectLanguage(text) === 'ar' ? 'ar' : 'en');
        const { data: assistantMsg, error: assistantMsgError } = await supabaseAdmin.from('messages').insert([{
          conversation_id: conversationId,
          clinic_id: clinicId,
          role: 'assistant',
          content: unavailableResponse,
          metadata: {
            provider: 'rag-fallback',
            citations: [],
            confidence: maxConfidence,
            has_sufficient_context: false,
            reason: 'clinic_fact_unavailable',
          },
        }]).select('*').single();
        if (assistantMsgError) throw assistantMsgError;
        return { userMessage: userMsg, assistantMessage: assistantMsg, citations };
      }

      // For general/complaint/greeting/unknown intents, proceed to the LLM.
      // We pass empty context — the AI may answer from its general knowledge
      // or ask clarifying questions, without showing RAG errors.
      const emptyContextForPrompt: RetrievalResult[] = [];
      const emptyCitations: SourceCitation[] = [];
      const promptOptionsWithoutContext = {
        confidenceThreshold: effectiveConfidenceThreshold,
        operatingData,
        receptionistState: promptReceptionState,
        clinicInfo: buildClinicInfo(clinicProfile),
        safetyRules: [
          'Never provide a medical diagnosis.',
          'Never prescribe medication or recommend specific dosages.',
          'For any urgent or emergency concern, advise the patient to seek immediate professional care.',
          'Do not guess or fabricate clinic-specific information.',
        ],
        answerBoundaries: [
          'Answer general questions naturally.',
          'For patient complaints, respond with empathy and ask useful clarifying questions (one or two at a time).',
          'DO NOT claim medical diagnosis certainty.',
          'If the patient asks about clinic-specific details you do not have, say so honestly and offer human assistance.',
        ],
        handoffConditions: [
          'Hand off to a human agent if the patient requests emergency care or has urgent symptoms.',
          'Hand off to a human agent if the patient explicitly asks to speak with staff.',
          'Hand off to a human agent if the patient expresses dissatisfaction or a complaint.',
        ],
        intent: intelligence.intent,
        conversationState: intelligence.state,
        patientContext: {
          name: intelligence.appointment?.patientName ?? null,
          phone: intelligence.appointment?.phone ?? null,
          email: intelligence.appointment?.email ?? null,
          requestedService: intelligence.appointment?.requestedService ?? null,
          preferredDate: intelligence.appointment?.preferredDate ?? null,
          preferredTime: intelligence.appointment?.preferredTime ?? null,
        },
      };
      const prompt = buildPrompt(settingsData || null, text, history, emptyContextForPrompt, emptyCitations, promptOptionsWithoutContext);

      const provider = getProvider(modelPreference || undefined);
      const start = Date.now();
      const result = await generateWithFailover({ prompt, preferredProviderId: modelPreference || undefined });
      const took = Date.now() - start;
      const usedProviderId = result.providerId ?? provider?.id;

      const { data: assistantMsg, error: assistantMsgError } = await supabaseAdmin.from('messages').insert([
        {
          conversation_id: conversationId,
          clinic_id: clinicId,
          role: 'assistant',
          content: result.text,
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          model: result.model || null,
          response_time_ms: took,
          metadata: {
            provider: usedProviderId,
            intelligence,
            citations: [],
            context_tokens: 0,
            context_truncated: false,
            has_sufficient_context: false,
            reason: 'general_conversation',
          },
        },
      ]).select('*').single();
      if (assistantMsgError) throw assistantMsgError;

      if (result.totalTokens && result.totalTokens > 0) {
        const estimatedCost = calculateCost(result.model, result.promptTokens ?? 0, result.completionTokens ?? 0);
        await supabaseAdmin.from('ai_usage').insert([
          { clinic_id: clinicId, model: result.model || null, prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, total_tokens: result.totalTokens, estimated_cost: estimatedCost },
        ]);
      }

      logEvent('ai_request_completed_general', { clinic_id: clinicId, conversation_id: conversationId, provider: usedProviderId, took_ms: took, tokens: result.totalTokens, intent: intelligence.intent });
      return { userMessage: userMsg, assistantMessage: assistantMsg, citations: [] };
    }

    // --- Prompt Construction ---
    // Pass full PromptOptions: clinic info, safety rules, handoff conditions,
    // intent, conversation state, and patient context from intelligence.
    const promptOptions = {
      confidenceThreshold: configuredConfidenceThreshold,
      operatingData,
      receptionistState: promptReceptionState,
      clinicInfo: buildClinicInfo(clinicProfile),
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
      intent: intelligence.intent,
      conversationState: intelligence.state,
      patientContext: {
        name: intelligence.appointment?.patientName,
        phone: intelligence.appointment?.phone,
        email: intelligence.appointment?.email,
        requestedService: intelligence.appointment?.requestedService,
        preferredDate: intelligence.appointment?.preferredDate,
        preferredTime: intelligence.appointment?.preferredTime,
      },
    };

    // Include patient context from intelligence when available
    const prompt = citations.length > 0
      ? buildPrompt(settingsData || null, text, history, contextForPrompt, citations, promptOptions)
      : buildPrompt(settingsData || null, text, history, contextForPrompt, undefined, promptOptions);

    const provider = getProvider(modelPreference || undefined);

    const start = Date.now();
    const result = await generateWithFailover({ prompt, preferredProviderId: modelPreference || undefined });
    const took = Date.now() - start;
    const usedProviderId = result.providerId ?? provider?.id;

    // Detect response language for multilingual support
    const responseLanguage = detectLanguage(result.text);

    // Persist assistant message with citations
    // Build assistant metadata and include structured actions for booking flows
    const assistantMetadata: any = {
      provider: usedProviderId,
      raw: result.raw,
      intelligence,
      citations,
      context_tokens: contextTokens,
      context_truncated: contextTruncated,
      has_sufficient_context: hasSufficientContext,
      response_language: responseLanguage,
      // STEP 4 — which authoritative sources were actually available for this
      // reply. Analytics/debugging only; never changes the reply text.
      source_tags: [
        ...(clinicProfile?.hasProfile ? ['clinic_facts'] : []),
        ...(operatingData.usable ? ['operating_data'] : []),
        ...(citations.length > 0 ? ['rag'] : []),
        ...(hasSufficientContext ? [] : ['general_knowledge_only']),
        ...(currentState?.booking?.slot ? ['real_availability'] : []),
      ],
    };

    // Emit structured actions for client-side automation when intent is booking/reschedule/cancel
    const intent = (intelligence && (intelligence.intent || '')).toString().toLowerCase();
    if (intent.includes('book') || intent.includes('booking') || intent.includes('appointment')) {
      assistantMetadata.actions = [
        {
          type: 'suggest_booking',
          suggested_service: intelligence.appointment?.requestedService ?? null,
          suggested_date: intelligence.appointment?.preferredDate ?? null,
          suggested_time: intelligence.appointment?.preferredTime ?? null,
        },
      ];
    } else if (intent.includes('resched') || intent.includes('reschedule')) {
      assistantMetadata.actions = [
        {
          type: 'suggest_reschedule',
          appointment_id: null,
        },
      ];
    } else if (intent.includes('cancel') || intent.includes('cancell')) {
      assistantMetadata.actions = [
        {
          type: 'suggest_cancel',
          appointment_id: null,
        },
      ];
    }

    const { data: assistantMsg, error: assistantMsgError } = await supabaseAdmin.from('messages').insert([
      {
        conversation_id: conversationId,
        clinic_id: clinicId,
        role: 'assistant',
        content: result.text,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        model: result.model || null,
        response_time_ms: took,
        metadata: assistantMetadata,
      },
    ]).select('*').single();
    if (assistantMsgError) throw assistantMsgError;

    // Track usage
    if (result.totalTokens && result.totalTokens > 0) {
      const estimatedCost = calculateCost(result.model, result.promptTokens ?? 0, result.completionTokens ?? 0);
      await supabaseAdmin.from('ai_usage').insert([
        {
          clinic_id: clinicId,
          model: result.model || null,
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          total_tokens: result.totalTokens,
          estimated_cost: estimatedCost,
        },
      ]);
    }

    await supabaseAdmin.from('ai_events').insert([
      { clinic_id: clinicId, conversation_id: conversationId, event_type: 'conversation_response', payload: { tokens: result.totalTokens ?? ((result.promptTokens ?? 0) + (result.completionTokens ?? 0)), took, intent: intelligence.intent, citations_count: citations.length, max_confidence: maxConfidence } },
    ]);

    logEvent('ai_request_completed', { clinic_id: clinicId, conversation_id: conversationId, session_id: sessionId, user_id: userId, provider: usedProviderId, took_ms: took, tokens: result.totalTokens, citations: citations.length });

    return { userMessage: userMsg, assistantMessage: assistantMsg, citations };
  } catch (error) {
    logEvent('ai_request_failed', {
      clinic_id: clinicId,
      conversation_id: conversationId,
      session_id: sessionId,
      user_id: userId,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    }, 'error');

    // Graceful degradation (DR: AI provider outage): the patient's message is
    // already persisted. Persist a safe fallback assistant reply and mark the
    // conversation for human follow-up so no conversation is left one-sided
    // and the clinic knows staff attention may be required.
    try {
      const fallbackText =
        'عذراً، حدثت مشكلة مؤقتة في النظام ولا أستطيع الرد الآن. تم تسجيل رسالتك وسيقوم فريق العيادة بمتابعتك في أقرب وقت.';
      const { data: fallbackMsg } = await supabaseAdmin
        .from('messages')
        .insert([
          {
            conversation_id: conversationId,
            clinic_id: clinicId,
            role: 'assistant',
            content: fallbackText,
            metadata: { fallback: true, handoff_recommended: true },
          },
        ])
        .select('*').single();
      await supabaseAdmin
        .from('conversations')
        .update({ state: 'awaiting_staff' })
        .eq('id', conversationId)
        .eq('clinic_id', clinicId);
      logEvent('ai_fallback_persisted', { clinic_id: clinicId, conversation_id: conversationId });
      return { userMessage: null as any, assistantMessage: fallbackMsg ?? null, citations: [] };
    } catch (fallbackError) {
      logEvent('ai_fallback_failed', { clinic_id: clinicId, conversation_id: conversationId, error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }, 'error');
    }
    throw error;
  }
}
