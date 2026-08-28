import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Central authorization gate for clinic-scoped API routes.
 *
 * Flow (security order):
 *  1. Extract Bearer access_token from the request.
 *  2. Verify the token with the anon-key auth client → real authenticated user.
 *  3. Query `clinic_users` with the SERVER-SIDE privileged client (supabaseAdmin),
 *     scoped strictly by (user_id, clinic_id, deleted_at IS NULL).
 *     RLS on the anon client would otherwise block the server-side membership
 *     lookup; the token has already confirmed identity before this step.
 *  4. Only if a real membership row exists do we authorize the clinic.
 *
 * The service-role client is used ONLY here, AFTER authentication, and never
 * in the browser. No arbitrary clinic_id is trusted until a membership exists.
 */
export async function authorizeClinicRequest(req: Request, clinicId: string) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { authorized: false, status: 401 as const };

  // 1+2. Verify the token -> authenticated user (anon-key client; the browser
  //      sends ONLY a real user access token, never the service-role key).
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return { authorized: false, status: 401 as const };

  // 3. Verify membership with server-side privileged client, scoped by the
  //    authenticated user id AND the requested clinic id. Never trusts a
  //    client-provided clinic_id without a matching membership row.
  const { data: member, error: memberError } = await supabaseAdmin
    .from('clinic_users')
    .select('role')
    .eq('clinic_id', clinicId)
    .eq('user_id', authData.user.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (memberError || !member) return { authorized: false, status: 403 as const };

  return { authorized: true, user: authData.user, role: member.role } as const;
}

export async function getAuthorizedClinicMember(req: Request, clinicId: string) {
  const authorization = await authorizeClinicRequest(req, clinicId);
  if (!authorization.authorized) {
    return authorization;
  }

  return {
    authorized: true,
    user: authorization.user,
    role: authorization.role,
  } as const;
}

/**
 * Known clinic roles. The DB currently only contains 'owner', but these are
 * the roles the system recognizes; unknown roles are treated as least-privilege.
 */
export const CLINIC_ROLES = ['owner', 'manager', 'doctor', 'receptionist', 'accountant', 'staff'] as const;
export type ClinicRole = (typeof CLINIC_ROLES)[number];

/** Roles allowed to perform administrative/mutating actions on clinic config. */
export const ADMIN_ROLES: readonly string[] = ['owner', 'manager'];
/** Roles allowed to READ operational clinic data (members of the clinic). */
export const DATA_ROLES: readonly string[] = [...ADMIN_ROLES, 'doctor', 'receptionist', 'staff'];

/**
 * Role gate on top of membership: authenticated + member + role check.
 * Returns a NextResponse-shaped rejection or null when allowed.
 */
export function roleDenied(
  authorization: { authorized: boolean; status?: number; role?: string },
  allowedRoles: readonly string[]
): { authorized: false; status: 401 | 403 } | null {
  if (!authorization.authorized) {
    return { authorized: false, status: (authorization.status ?? 401) as 401 | 403 };
  }
  if (!allowedRoles.includes(authorization.role ?? '')) {
    return { authorized: false, status: 403 };
  }
  return null;
}
