import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getProvider } from './provider';
import { openStreamWithFailover } from './resilience';
import { retrieveContext } from './contextRetrieval';
import { buildPrompt } from './promptManager';
import { analyzeAndPersistMessage } from '@/lib/services/conversationIntelligence';
import { getConversationHistory } from '@/lib/services/messageService';
import { updateConversationState } from '@/lib/services/conversationService';
import { notifyStaffForHandoff } from '@/lib/services/notificationService';
import { calculateCost } from '@/lib/services/aiCostService';
import { moderateUserPrompt, ContentFlaggedError } from './security';
import { persistHandoffReply } from './handoffMessages';
import { StreamingTextResponse } from './streamingResponse';
import { detectLanguage } from '@/lib/services/knowledge/multilingual';
import type { AssembledContext } from '@/lib/services/knowledge/contextAssembly';

export async function streamAndRecordResponse(opts: {
  clinicId: string;
  conversationId: string;
  sessionId?: string | null;
  userId?: string | null;
  text: string;
  modelPreference?: string | null;
}) {
  const { clinicId, conversationId, sessionId, userId, text, modelPreference } = opts;

  const provider = getProvider(modelPreference || undefined);
  if (!provider) {
    throw new Error('AI runtime is not configured. Please register an AI provider.');
  }
  if (!provider.stream) {
    throw new Error(`AI provider "${provider.id}" does not support streaming. Use the non-streaming path.`);
  }

  // --- Pre-flight checks (extracted from original orchestrator) ---
  const { error: userMsgError } = await supabaseAdmin.from('messages').insert([{
    conversation_id: conversationId,
    clinic_id: clinicId,
    role: 'patient',
    sender_id: userId,
    content: text,
  }]);
  if (userMsgError) throw userMsgError;

  const { data: settingsData } = await supabaseAdmin.from('clinic_ai_settings').select('*').eq('clinic_id', clinicId).limit(1).single();
  const intelligence = await analyzeAndPersistMessage(supabaseAdmin, {
    clinicId,
    conversationId,
    text,
    confidenceThreshold: Number(settingsData?.confidence_threshold ?? 0.65),
  });

  if (intelligence.shouldHandoff) {
    await updateConversationState(conversationId, 'awaiting_staff', clinicId);
    await notifyStaffForHandoff(clinicId, conversationId);
    logEvent('ai_handoff_triggered', { clinic_id: clinicId, conversation_id: conversationId, reason: intelligence.intent });
    // P0 FIX: persist + return the exact patient-facing reply (emergency gets
    // urgent-care instructions) instead of an English-only technical ack.
    const handoffReply = await persistHandoffReply({
      supabase: supabaseAdmin,
      clinicId,
      conversationId,
      intent: intelligence.intent,
    });
    return new Response(
      JSON.stringify({
        message: 'Handoff triggered. An agent will be with you shortly.',
        handoff: true,
        emergency: handoffReply.emergency,
        assistant_message: { role: 'assistant', content: handoffReply.content },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Security: Moderate user input before processing
  try {
    await moderateUserPrompt(text);
  } catch (error) {
    if (error instanceof ContentFlaggedError) {
      return new Response(JSON.stringify({ error: 'Your message could not be processed due to content policy.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // For other moderation errors, we allow processing to continue but the error is logged.
  }

  const history = await getConversationHistory(conversationId, 10);
  // Use the clinic-configured confidence threshold (same source + fallback as
  // the non-streaming orchestrator) so RAG assembly and the sufficiency gate
  // stay consistent, and strong-but-sparse chunks are not rejected by the
  // hard-coded assembly default. Passed through to retrieveContext so
  // assembleContext() computes hasSufficientContext against THIS value.
  const configuredConfidenceThreshold = Number(
    settingsData?.confidence_threshold ?? settingsData?.safety_controls?.confidence_threshold ?? 0.7
  );
  const retrieved = await retrieveContext(clinicId, text, 5, 2000, configuredConfidenceThreshold);
  // Normalize: handle both old-style (array) and new-style (AssembledContext) returns
  const contextForPrompt = Array.isArray(retrieved)
    ? retrieved
    : (retrieved.chunks?.map((chunk) => chunk.result || {
      id: chunk.citation.chunkId,
      document_id: chunk.citation.documentId,
      chunk_index: chunk.citation.chunkIndex,
      content: chunk.content,
      similarity: chunk.citation.confidenceScore,
      confidenceScore: chunk.citation.confidenceScore,
      type: 'unstructured' as const,
    }) || []);
  const isAssembledContext = !Array.isArray(retrieved);
  if (isAssembledContext) {
    const assembled = retrieved as AssembledContext;
    const maxConfidence = assembled.citations.reduce(
      (maximum, citation) => Math.max(maximum, citation.confidenceScore),
      0
    );
    if (!assembled.hasSufficientContext || assembled.hasConflictingContext || maxConfidence < configuredConfidenceThreshold) {
      const unavailableResponse = detectLanguage(text) === 'ar'
        ? 'عذرًا، لا تتوفر لدي معلومات موثوقة للإجابة عن هذا السؤال.'
        : "I'm sorry, I don't have enough reliable information to answer that question.";
      return new Response(unavailableResponse, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }
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

  const prompt = isAssembledContext
    ? buildPrompt(settingsData || null, text, history, contextForPrompt as any, (retrieved as AssembledContext).citations, promptOptions)
    : buildPrompt(settingsData || null, text, history, contextForPrompt as any, undefined, promptOptions);

  // --- Streaming Implementation (STEP 8: resilient stream OPEN) ---
  // Fetching the stream (provider handshake) goes through the SAME bounded
  // retry + failover used by the non-streaming path. Once bytes flow we cannot
  // switch providers, so only the open is hardened — this fixes a real gap
  // where a single transient provider hiccup failed the whole streaming turn.
  const start = Date.now();
  const openResult = await openStreamWithFailover({
    prompt,
    maxTokens: 1024,
    temperature: 0.2,
    preferredProviderId: modelPreference || undefined,
  });
  const stream = openResult.stream;
  const providerName = openResult.providerId;

  const streamWithRecord = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let completion = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const textChunk = decoder.decode(value, { stream: true });
          completion += textChunk;
          controller.enqueue(encoder.encode(textChunk));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        // Fire-and-forget finalization — do not block the stream close.
        const took = Date.now() - start;
        const model = modelPreference || undefined;
        const promptTokens = 0;
        const completionTokens = 0;
        const totalTokens = 0;

        try {
          await supabaseAdmin.from('messages').insert([{
            conversation_id: conversationId,
            clinic_id: clinicId,
            role: 'assistant',
            content: completion,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            model: model,
            response_time_ms: took,
            metadata: {
              provider: providerName,
              intelligence,
              streaming: true,
              has_sufficient_context: true,
            },
          }]);

          const estimatedCost = calculateCost(model || providerName, promptTokens, completionTokens);
          await supabaseAdmin.from('ai_usage').insert([{
            clinic_id: clinicId,
            model: model || providerName,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            estimated_cost: estimatedCost,
          }]);

          logEvent('ai_request_completed', { clinic_id: clinicId, conversation_id: conversationId, provider: providerName, took_ms: took, tokens: totalTokens, streaming: true });
        } catch (err) {
          console.error('[StreamingOrchestrator] onFinal error:', err);
        }
      }
    },
  });

  return new StreamingTextResponse(streamWithRecord);
}
