import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { upsertRecallRules, getRecallRules } from '@/lib/services/recallService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 3 — Recall rules (owner/manager only).
 * GET: current rules · PATCH: upsert rules (enabled, interval_days, channels).
 */
export const runtime = 'nodejs';

const rulesSchema = z.object({
  clinic_id: z.string().uuid(),
  enabled: z.boolean(),
  interval_days: z.coerce.number().int().min(7).max(1095),
  channels: z.array(z.enum(['whatsapp', 'telegram', 'sms', 'email'])).min(1).max(4),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const rules = await getRecallRules(clinicId);
    return NextResponse.json({ data: rules });
  } catch (err) {
    logEvent('recall_rules_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = rulesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id, enabled, interval_days, channels } = parsed.data;
    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإدارة' }, { status: 403 });

    const rules = await upsertRecallRules({ clinicId: clinic_id, enabled, intervalDays: interval_days, channels });
    return NextResponse.json({ data: rules });
  } catch (err) {
    logEvent('recall_rules_patch_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}