import { supabase } from '@/lib/supabase';

export async function authorizeClinicRequest(req: Request, clinicId: string) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { authorized: false, status: 401 as const };
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return { authorized: false, status: 401 as const };
  const { data: member, error: memberError } = await supabase.from('clinic_users').select('role').eq('clinic_id', clinicId).eq('user_id', authData.user.id).is('deleted_at', null).limit(1).single();
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
