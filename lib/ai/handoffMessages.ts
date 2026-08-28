import { logEvent } from '@/lib/server/logging';

/**
 * Patient-facing handoff messages.
 *
 * ROOT-CAUSE FIX (P0): when the conversation hands off to staff — including
 * EMERGENCY triage — the orchestrator previously returned `null` and the
 * public route fabricated a generic "حدثت مشكلة مؤقتة" (temporary problem)
 * message. For an emergency that is a SAFETY failure: the patient must
 * immediately receive clear urgent-care instructions, not a system apology.
 *
 * The messages here are intentionally:
 *  - In clear Arabic (the product's primary language).
 *  - Free of invented data (no clinic phone numbers / addresses — those come
 *    only from live clinic configuration; we reference "فريق العيادة" instead).
 *  - Non-diagnostic: they state urgency and direct to professional care.
 */

export const EMERGENCY_HANDOFF_MESSAGE = [
  '🚨 بناءً على وصفك، في مؤشرات إنو حالتك بحاجة تقييم طبي عاجل.',
  'إذا عندك الآن أي من هذه الأعراض: صعوبة بالتنفس أو البلع، تورّم شديد بالوجه أو الفك، أو نزيف ما بيوقف:',
  '• توجه لأقرب قسم طوارئ فوراً، أو اتصل برقم الطوارئ المحلي.',
  '• لا تنتظر موعداً عادياً في هذه الحالة.',
  'تم إبلاغ فريق العيادة الآن وسيتواصل معك بأسرع وقت لمتابعة حالتك.',
].join('\n');

export const HUMAN_HANDOFF_MESSAGE = [
  'تم تحويل محادثتك إلى فريق العيادة 👋',
  'سيتواصل معك أحد الموظفين في أقرب وقت.',
  'كل المعلومات التي شاركتها محفوظة، فلن تحتاج لإعادة شرحها من البداية.',
].join('\n');

export type HandoffReply = {
  content: string;
  emergency: boolean;
};

/**
 * Maps a handoff reason (conversation intent) to the exact reply the patient
 * should see. Pure + deterministic so it can be unit-tested without a DB.
 */
export function handoffReplyForIntent(intent: string): HandoffReply {
  const emergency = intent === 'emergency' || intent === 'urgent_signal';
  return {
    content: emergency ? EMERGENCY_HANDOFF_MESSAGE : HUMAN_HANDOFF_MESSAGE,
    emergency,
  };
}

/**
 * Persists the handoff reply as an assistant message so the transcript shows
 * exactly what the patient was told. Never throws — a persistence failure is
 * logged but must not prevent the reply from reaching the caller.
 */
export async function persistHandoffReply(params: {
  supabase: { from(table: string): any };
  clinicId: string;
  conversationId: string;
  intent: string;
}): Promise<HandoffReply & { persistedId: string | null }> {
  const reply = handoffReplyForIntent(params.intent);
  try {
    const { data, error } = await params.supabase
      .from('messages')
      .insert([
        {
          conversation_id: params.conversationId,
          clinic_id: params.clinicId,
          role: 'assistant',
          content: reply.content,
          metadata: {
            handoff: true,
            emergency: reply.emergency,
            handoff_reason: params.intent,
          },
        },
      ])
      .select('id')
      .single();
    if (error) throw error;
    logEvent('handoff_reply_persisted', {
      clinic_id: params.clinicId,
      conversation_id: params.conversationId,
      intent: params.intent,
      emergency: reply.emergency,
    });
    return { ...reply, persistedId: data?.id ?? null };
  } catch (err) {
    logEvent('handoff_reply_persist_failed', {
      clinic_id: params.clinicId,
      conversation_id: params.conversationId,
      error: err instanceof Error ? err.message : String(err),
    }, 'error');
    return { ...reply, persistedId: null };
  }
}
