import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';
import { getProvider, registerProvider } from './provider';
import { OpenAIProvider } from './providers/openai';
import { retrieveContext } from './contextRetrieval';
import { buildPrompt } from './promptManager';
import { analyzeAndPersistMessage } from '@/lib/services/conversationIntelligence';

// Register example providers
registerProvider(OpenAIProvider);

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

  if (!conversationId) {
    logEvent('ai_request_failed', { clinic_id: clinicId, session_id: sessionId, user_id: userId, error: 'conversationId is required for AI conversation intelligence' }, 'error');
    throw new Error('conversationId is required for AI conversation intelligence');
  }

  try {
    // Persist incoming message
    const { data: userMsg } = await supabase.from('messages').insert([
      {
        conversation_id: conversationId,
        clinic_id: clinicId,
        role: 'patient',
        sender_id: userId,
        content: text,
      },
    ]).select('*').single();

    // Retrieve clinic settings and context
    const { data: settingsData } = await supabase.from('clinic_ai_settings').select('*').eq('clinic_id', clinicId).limit(1).single();
    const intelligence = await analyzeAndPersistMessage(supabase, {
      clinicId,
      conversationId,
      text,
      confidenceThreshold: Number(settingsData?.confidence_threshold ?? settingsData?.safety_controls?.confidence_threshold ?? 0.65),
    });

    const context = await retrieveContext(clinicId, text, 5);

    const prompt = buildPrompt(settingsData || null, text, context as any[]);

    const provider = getProvider(modelPreference || undefined);

    const start = Date.now();
    const result = await provider.generate({ prompt });
    const took = Date.now() - start;

    // Persist assistant message
    const { data: assistantMsg } = await supabase.from('messages').insert([
      {
        conversation_id: conversationId,
        clinic_id: clinicId,
        role: 'assistant',
        content: result.text,
        tokens: result.tokens || null,
        model: result.model || null,
        response_time_ms: took,
        metadata: { provider: provider.id, raw: result.raw, intelligence },
      },
    ]).select('*').single();

    // Track usage
    if (result.tokens && result.tokens > 0) {
      await supabase.from('ai_usage').insert([
        {
          clinic_id: clinicId,
          model: result.model || null,
          tokens_consumed: result.tokens,
          estimated_cost: null,
        },
      ]);
    }

    await supabase.from('ai_events').insert([
      { clinic_id: clinicId, conversation_id: conversationId, event_type: 'conversation_response', payload: { tokens: result.tokens, took, intent: intelligence.intent } },
    ]);

    logEvent('ai_request_completed', { clinic_id: clinicId, conversation_id: conversationId, session_id: sessionId, user_id: userId, provider: provider.id, took_ms: took, tokens: result.tokens });

    return assistantMsg;
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
