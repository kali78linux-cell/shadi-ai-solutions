import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { cancelRecall } from '@/lib/services/recallService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 3 — Cancel a pending/notified recall (owner/manager only).
 */
export const runtime = 'nodejs';

const cancelSchema = z.object({
  clinic_id: z.string().uuid(),
  recall_id: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, recall_id } = parsed.data;
    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإدارة' }, { status: 403 });

    await cancelRecall(clinic_id, recall_id);
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    logEvent('recall_cancel_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}