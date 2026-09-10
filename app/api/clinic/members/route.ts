import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import { assertEntitlement, releaseEntitlement, entitlementErrorResponse } from '@/lib/subscription/entitlements';

export const runtime = 'nodejs';

const VALID_ROLES = ['owner', 'manager', 'doctor', 'receptionist', 'staff'] as const;
type Role = (typeof VALID_ROLES)[number];

const addSchema = z.object({
  email: z.string().email(),
  role: z.enum(VALID_ROLES).optional().default('staff'),
});

const patchSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(VALID_ROLES).optional(),
  is_active: z.boolean().optional(),
});

const deleteSchema = z.object({ user_id: z.string().uuid() });

// P0 fix — clinic_users has NO is_active column (PP-8D-era bug: GET returned
// 500 "تعذر جلب الأعضاء"). Membership activity is `deleted_at IS NULL` — the
// same soft-delete convention as providers/clinics. `is_active` is derived
// server-side in responses so the Team UI contract stays unchanged.
async function countActiveOwners(clinicId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('clinic_users')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('role', 'owner')
    .is('deleted_at', null);
  return count ?? 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get('clinic_id');
  if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

  const authorization = await authorizeClinicRequest(req, clinicId);
  if (!authorization.authorized) {
    return NextResponse.json(
      { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: authorization.status }
    );
  }

  // Only admins can view the member list.
  if (roleDenied(authorization, ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from('clinic_users')
    .select('id, user_id, role, deleted_at, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true });

  if (error) {
    logEvent('members_list_error', { error: error.message }, 'error');
    return NextResponse.json({ error: 'تعذر جلب الأعضاء' }, { status: 500 });
  }

  // Enrich with emails from auth admin (server-side only).
  const members = [] as Array<Record<string, unknown>>;
  for (const row of data ?? []) {
    let email: string | null = null;
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
      email = userData?.user?.email ?? null;
    } catch {
      email = null;
    }
    members.push({ ...row, is_active: row.deleted_at === null, email });
  }

  return NextResponse.json({ data: members });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get('clinic_id');
  if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

  const authorization = await authorizeClinicRequest(req, clinicId);
  if (!authorization.authorized) {
    return NextResponse.json(
      { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: authorization.status }
    );
  }
  if (roleDenied(authorization, ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const { email, role } = parsed.data;

  // Find existing auth user by email; do NOT create accounts here.
  let targetUserId: string | null = null;
  try {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    targetUserId = list?.users?.find((u: { email?: string | null }) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  } catch {
    targetUserId = null;
  }
  if (!targetUserId) {
    return NextResponse.json({ error: 'المستخدم غير موجود. يجب أن يسجل حساباً أولاً.' }, { status: 404 });
  }

  // Cannot add a member to a different clinic than the authorized one (scope enforced by clinicId).
  const { data: existing } = await supabaseAdmin
    .from('clinic_users')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: 'المستخدم عضو بالفعل في هذه العيادة' }, { status: 409 });

  // STEP 15C — server-side plan limit (users). Blocked at the limit → 402;
  // failed writes below are never counted (compensating release).
  try {
    await assertEntitlement(clinicId, 'users');
  } catch (err) {
    const entitlementResponse = entitlementErrorResponse(err);
    if (entitlementResponse) return entitlementResponse;
    throw err;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('clinic_users')
    .insert({ clinic_id: clinicId, user_id: targetUserId, role })
    .select('id, user_id, role, deleted_at')
    .single();

  if (insertError) {
    await releaseEntitlement(clinicId, 'users');
    logEvent('members_add_error', { error: insertError.message }, 'error');
    return NextResponse.json({ error: 'تعذر إضافة العضو' }, { status: 500 });
  }

  await writeAuditLog({
    clinicId,
    actorUserId: authorization.user.id,
    action: 'member.add',
    resourceType: 'clinic_user',
    resourceId: inserted.id,
    metadata: { email, role },
  });

  return NextResponse.json({ data: inserted }, { status: 201 });
}

export async function PATCH(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get('clinic_id');
  if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

  const authorization = await authorizeClinicRequest(req, clinicId);
  if (!authorization.authorized) {
    return NextResponse.json(
      { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: authorization.status }
    );
  }
  if (roleDenied(authorization, ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const { user_id, role, is_active } = parsed.data;

  // Self-role escalation guard: admins cannot change their own membership.
  if (user_id === authorization.user.id) {
    return NextResponse.json({ error: 'لا يمكنك تعديل عضويتك الخاصة' }, { status: 403 });
  }

  const { data: target } = await supabaseAdmin
    .from('clinic_users')
    .select('id, role, deleted_at')
    .eq('clinic_id', clinicId)
    .eq('user_id', user_id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'العضو غير موجود في هذه العيادة' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (role !== undefined) updates.role = role;
  if (is_active !== undefined) updates.deleted_at = is_active ? null : new Date().toISOString();
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'لا يوجد تغيير' }, { status: 400 });
  }

  // Last-owner protection: cannot demote or disable the only active owner.
  const touchesOwnerProtection =
    (role !== undefined && target.role === 'owner' && role !== 'owner') ||
    (is_active === false && target.role === 'owner' && target.deleted_at === null);
  if (touchesOwnerProtection && (await countActiveOwners(clinicId)) <= 1) {
    return NextResponse.json({ error: 'لا يمكن إزالة آخر مالك للعيادة' }, { status: 409 });
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('clinic_users')
    .update(updates)
    .eq('id', target.id)
    .select('id, user_id, role, deleted_at')
    .single();

  if (updateError) {
    logEvent('members_update_error', { error: updateError.message }, 'error');
    return NextResponse.json({ error: 'تعذر تحديث العضو' }, { status: 500 });
  }

  await writeAuditLog({
    clinicId,
    actorUserId: authorization.user.id,
    action: is_active !== undefined ? (is_active ? 'member.enable' : 'member.disable') : 'member.role_change',
    resourceType: 'clinic_user',
    resourceId: target.id,
    metadata: { user_id, before: { role: target.role, deleted_at: target.deleted_at }, after: updates },
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get('clinic_id');
  if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

  const authorization = await authorizeClinicRequest(req, clinicId);
  if (!authorization.authorized) {
    return NextResponse.json(
      { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: authorization.status }
    );
  }
  if (roleDenied(authorization, ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const { user_id } = parsed.data;

  // Self-removal guard.
  if (user_id === authorization.user.id) {
    return NextResponse.json({ error: 'لا يمكنك إزالة عضويتك الخاصة' }, { status: 403 });
  }

  const { data: target } = await supabaseAdmin
    .from('clinic_users')
    .select('id, role, deleted_at')
    .eq('clinic_id', clinicId)
    .eq('user_id', user_id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'العضو غير موجود في هذه العيادة' }, { status: 404 });

  // Last-owner protection.
  if (target.role === 'owner' && target.deleted_at === null && (await countActiveOwners(clinicId)) <= 1) {
    return NextResponse.json({ error: 'لا يمكن إزالة آخر مالك للعيادة' }, { status: 409 });
  }

  // Soft-delete semantics: keep history, deactivate + detach role.
  const { error: delError } = await supabaseAdmin
    .from('clinic_users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', target.id);

  if (delError) {
    logEvent('members_remove_error', { error: delError.message }, 'error');
    return NextResponse.json({ error: 'تعذر إزالة العضو' }, { status: 500 });
  }

  await writeAuditLog({
    clinicId,
    actorUserId: authorization.user.id,
    action: 'member.remove',
    resourceType: 'clinic_user',
    resourceId: target.id,
    metadata: { user_id, previous_role: target.role },
  });

  return NextResponse.json({ success: true });
}
