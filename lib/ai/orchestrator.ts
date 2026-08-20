import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getProvider, registerProvider } from './provider';
import { OpenAIProvider } from './providers/openai';
import { OllamaProvider } from './providers/ollama';
import { AnthropicProvider } from './providers/anthropic';
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

type HistoryMessage = Pick<Message, 'role' | 'content'>;

/**
 * Registers the active AI provider based on the AI_PROVIDER environment variable.
 * - AI_PROVIDER=ollama → Ollama (local, zero-cost)
 * - AI_PROVIDER=openai or unset → OpenAI (cloud, production)
 * Both providers are registered so getProvider() falls back correctly.
 */
function registerActiveProvider() {
  registerProvider(OpenAIProvider);
  registerProvider(OllamaProvider);
  registerProvider(AnthropicProvider);
}
registerActiveProvider();

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
      // Return null to signify that no AI response should be sent.
      return null;
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
    const retrieved = await retrieveContext(clinicId, text, 5);
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

      if (clinicSpecificIntent && lowConfidence) {
        // Explicit "I don't know" for clinic facts — offer human assistance.
        const unavailableResponse = detectLanguage(text) === 'ar'
          ? 'هذه المعلومة غير متوفرة لدي حاليًا، ويمكنني تحويلك لموظفة الاستقبال.'
          : "This information isn't available to me right now. I can connect you with our receptionist.";
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
        clinicInfo: {
          name: settingsData?.clinic_name ?? null,
          address: settingsData?.clinic_address ?? null,
          phone: settingsData?.clinic_phone ?? null,
          website: settingsData?.clinic_website ?? null,
        },
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
      const result = await provider.generate({ prompt });
      const took = Date.now() - start;

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
            provider: provider.id,
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

      logEvent('ai_request_completed_general', { clinic_id: clinicId, conversation_id: conversationId, provider: provider.id, took_ms: took, tokens: result.totalTokens, intent: intelligence.intent });
      return { userMessage: userMsg, assistantMessage: assistantMsg, citations: [] };
    }

    // --- Prompt Construction ---
    // Pass full PromptOptions: clinic info, safety rules, handoff conditions,
    // intent, conversation state, and patient context from intelligence.
    const promptOptions = {
      confidenceThreshold: configuredConfidenceThreshold,
      clinicInfo: {
        name: settingsData?.clinic_name,
        address: settingsData?.clinic_address,
        phone: settingsData?.clinic_phone,
        website: settingsData?.clinic_website,
      },
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
    const result = await provider.generate({ prompt });
    const took = Date.now() - start;

    // Detect response language for multilingual support
    const responseLanguage = detectLanguage(result.text);

    // Persist assistant message with citations
    // Build assistant metadata and include structured actions for booking flows
    const assistantMetadata: any = {
      provider: provider.id,
      raw: result.raw,
      intelligence,
      citations,
      context_tokens: contextTokens,
      context_truncated: contextTruncated,
      has_sufficient_context: hasSufficientContext,
      response_language: responseLanguage,
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
      { clinic_id: clinicId, conversation_id: conversationId, event_type: 'conversation_response', payload: { tokens: result.tokens, took, intent: intelligence.intent, citations_count: citations.length, max_confidence: maxConfidence } },
    ]);

    logEvent('ai_request_completed', { clinic_id: clinicId, conversation_id: conversationId, session_id: sessionId, user_id: userId, provider: provider.id, took_ms: took, tokens: result.totalTokens, citations: citations.length });

    return { userMessage: userMsg, assistantMessage: assistantMsg, citations };
  } catch (error) {
    logEvent('ai_request_failed', {
      clinic_id: clinicId,
      conversation_id: conversationId,
      session_id: sessionId,
      user_id: userId,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    }, 'error');
    throw error;
  }
}
