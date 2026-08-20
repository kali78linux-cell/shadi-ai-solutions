import { NextResponse } from 'next/server';
import { processNotificationQueueWithDispatcher } from '@/lib/communications/dispatcher';
import { logEvent } from '@/lib/server/logging';

/**
 * Cron route handler that periodically processes the notification queue.
 *
 * This is the production scheduling mechanism for Next.js/Vercel.
 * Configure the schedule in `vercel.json` (Vercel Cron Jobs) or trigger
 * this endpoint from any external cron service.
 *
 * The queue remains the source of truth:
 *   - pending → sent (on success)
 *   - pending/failed → retried/failed (on failure, per existing retry behavior)
 *   - cancelled → never sent
 *   - sent → never re-sent
 *
 * Communication failures never change appointment state.
 */
export async function GET(req: Request) {
  try {
    // Optional: verify a cron secret if configured
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.get('authorization') || '';
      const token = auth.replace(/^Bearer\s+/i, '');
      if (token !== cronSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const results = await processNotificationQueueWithDispatcher({ limit: 50 });

    logEvent('notification_queue_processed', {
      processed: results.length,
    });

    return NextResponse.json({ data: { processed: results.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('notification_queue_processing_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}