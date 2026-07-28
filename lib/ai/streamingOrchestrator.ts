import { OpenAIStream, StreamingTextResponse } from 'ai';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';
import { retrieveContext } from './contextRetrieval';
import { buildPrompt } from './promptManager';
import { analyzeAndPersistMessage } from '@/lib/services/conversationIntelligence';
import { getConversationHistory } from '@/lib/services/messageService';
import { updateConversationState } from '@/lib/services/conversationService';
import { notifyStaffForHandoff } from '@/lib/services/notificationService';
import { calculateCost } from '@/lib/services/aiCostService';
import { moderateUserPrompt, ContentFlaggedError } from './security';

if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is not set. Streaming will not work.');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function streamAndRecordResponse(opts: {
  clinicId: string;
  conversationId: string;
  sessionId?: string | null;
  userId?: string | null;
  text: string;
  modelPreference?: string | null;
}) {
  const { clinicId, conversationId, sessionId, userId, text, modelPreference } = opts;

  // --- Pre-flight checks (extracted from original orchestrator) ---
  const { error: userMsgError } = await supabase.from('messages').insert([{
    conversation_id: conversationId,
    clinic_id: clinicId,
    role: 'patient',
    sender_id: userId,
    content: text,
  }]);
  if (userMsgError) throw userMsgError;

  const { data: settingsData } = await supabase.from('clinic_ai_settings').select('*').eq('clinic_id', clinicId).limit(1).single();
  const intelligence = await analyzeAndPersistMessage(supabase, {
    clinicId,
    conversationId,
    text,
    confidenceThreshold: Number(settingsData?.confidence_threshold ?? 0.65),
  });

  if (intelligence.shouldHandoff) {
    await updateConversationState(conversationId, 'awaiting_staff');
    await notifyStaffForHandoff(clinicId, conversationId);
    logEvent('ai_handoff_triggered', { clinic_id: clinicId, conversation_id: conversationId, reason: intelligence.intent });
    return new Response(JSON.stringify({ message: 'Handoff triggered. An agent will be with you shortly.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
  const context = await retrieveContext(clinicId, text, 5);
  const prompt = buildPrompt(settingsData || null, text, history, context as any[]);

  // --- Streaming Implementation ---
  const start = Date.now();
  const response = await openai.chat.completions.create({
    model: modelPreference || 'gpt-4o',
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  });

  const stream = OpenAIStream(response, {
    async onFinal(completion, data) {
      // This callback runs after the stream is fully sent to the client.
      // This is where we perform the "fire-and-forget" finalization logic.
      const took = Date.now() - start;
      const model = modelPreference || 'gpt-4o';
      
      // Use accurate token counts from the provider if available
      const usage = data?.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      const totalTokens = usage?.total_tokens ?? 0;

      // Persist the complete assistant message
      await supabase.from('messages').insert([{
        conversation_id: conversationId,
        clinic_id: clinicId,
        role: 'assistant',
        content: completion,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        model: model,
        response_time_ms: took,
        metadata: { provider: 'openai', intelligence, streaming: true },
      }]);

      // Track usage and cost
      const estimatedCost = calculateCost(model, promptTokens, completionTokens);
      await supabase.from('ai_usage').insert([{
        clinic_id: clinicId,
        model: model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens, // Corrected column name
        estimated_cost: estimatedCost,
      }]);

      logEvent('ai_request_completed', { clinic_id: clinicId, conversation_id: conversationId, provider: 'openai', took_ms: took, tokens: totalTokens, streaming: true });
    },
  });

  return new StreamingTextResponse(stream);
}