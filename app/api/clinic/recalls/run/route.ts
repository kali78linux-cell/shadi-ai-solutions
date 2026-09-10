import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { runRecallGeneration } from '@/lib/services/recallService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 3 — Recall generation trigger (owner/manager only).
 * POST: computes eligible patients and creates recall assignments + queue
 * rows (idempotent per cycle via the partial unique index).
 */
export const runtime = 'nodejs';

const runSchema = z.object({
  clinic_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = runSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, limit } = parsed.data;

    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإدارة' }, { status: 403 });

    const result = await runRecallGeneration({
      clinicId: clinic_id,
      actorUserId: auth.user?.id ?? null,
      limit,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    logEvent('recall_run_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}