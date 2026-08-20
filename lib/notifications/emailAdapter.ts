import { supabaseAdmin } from '@/lib/supabase/admin';
import { renderSubjectAndBody } from './templateRenderer';
import { logEvent } from '@/lib/server/logging';

type EmailPayload = {
  clinic_id?: string;
  to: string;
  template_subject?: string;
  template_body?: string;
  variables?: Record<string, any>;
  meta?: Record<string, any>;
};

export async function enqueueEmail(payload: EmailPayload) {
  try {
    const vars = payload.variables || {};
    const rendered = renderSubjectAndBody({ subject: payload.template_subject, body: payload.template_body }, vars);

    // Insert into notification_queue for background dispatcher to pick up
    const { data, error } = await supabaseAdmin
      .from('notification_queue')
      .insert([
        {
          clinic_id: payload.clinic_id || null,
          channel: 'email',
          recipient: payload.to,
          subject: rendered.subject,
          body: rendered.body,
          status: 'pending',
          meta: payload.meta || {},
        },
      ]);

    if (error) throw error;
    logEvent('enqueue_email', { clinic_id: payload.clinic_id, to: payload.to });
    const inserted: any = data;
    return { success: true, id: inserted && inserted[0] && inserted[0].id ? inserted[0].id : null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('enqueue_email_error', { error: message, clinic_id: payload.clinic_id, to: payload.to }, 'error');
    return { success: false, error: message };
  }
}
