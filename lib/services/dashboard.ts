import type { NextRequest } from 'next/server';
import { getCurrentUser, getPrimaryClinicMembership } from '@/lib/services/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function getClinicMetricsForCurrentUser(request: NextRequest) {
  const user = await getCurrentUser(request);
  const membership = await getPrimaryClinicMembership(user.id);

  if (!membership) {
    throw new Error('لم يتم العثور على عضوية لعيادة صالحة للمستخدم الحالي.');
  }

  const clinicId = membership.clinic_id;

  const appointmentsResult = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);

  const leadsResult = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);

  const unreadResult = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .neq('status', 'closed');

  if (appointmentsResult.error || leadsResult.error || unreadResult.error) {
    throw new Error('فشل جلب مؤشرات العيادة.');
  }

  return {
    appointmentsCount: appointmentsResult.count ?? 0,
    leadsCount: leadsResult.count ?? 0,
    unreadCount: unreadResult.count ?? 0,
    role: membership.role,
    clinic: membership.clinic ?? null,
  };
}
