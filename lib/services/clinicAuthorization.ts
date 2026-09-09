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
 * Accounting module role gates — finance operations.
 * Consumers (clinic accounting routes) import these; the documented semantics
 * are “owner/accountant” for admin finance actions, with read access granted
 * to managers for oversight, and receptionists allowed to record payments
 * (front-desk checkout) without any administrative finance power.
 */

/** Roles allowed to perform admin finance actions (voids, adjustments, write-offs). */
export const FINANCE_ADMIN_ROLES: readonly string[] = ['owner', 'accountant'];
/** Roles allowed to READ financial data (invoices, payments, balances). */
export const FINANCE_READ_ROLES: readonly string[] = [...FINANCE_ADMIN_ROLES, 'manager'];
/** Roles allowed to create invoices. */
export const INVOICE_CREATE_ROLES: readonly string[] = FINANCE_ADMIN_ROLES;
/** Roles allowed to record a payment against an invoice (front-desk checkout). */
export const PAYMENT_RECORD_ROLES: readonly string[] = [...FINANCE_ADMIN_ROLES, 'receptionist'];
/** Roles allowed to record expenses. */
export const EXPENSE_RECORD_ROLES: readonly string[] = FINANCE_ADMIN_ROLES;
/** Roles allowed to manage expense categories. */
export const EXPENSE_CATEGORY_MANAGE_ROLES: readonly string[] = FINANCE_ADMIN_ROLES;
/** Roles allowed to open a cash session (front desk / admin). */
export const CASH_SESSION_OPEN_ROLES: readonly string[] = [...FINANCE_ADMIN_ROLES, 'receptionist'];
/** Roles allowed to close a cash session (admin/accountant only). */
export const CASH_SESSION_CLOSE_ROLES: readonly string[] = FINANCE_ADMIN_ROLES;

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
