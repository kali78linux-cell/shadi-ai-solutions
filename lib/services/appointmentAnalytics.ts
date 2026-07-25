import { supabase } from '@/lib/supabase';

export async function getAppointmentAnalytics(clinicId: string, from?: string, to?: string) {
  const start = from ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const end = to ?? new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
  const { data, error } = await supabase.from('appointments').select('status, scheduled_at, created_at, provider_id').eq('clinic_id', clinicId).gte('scheduled_at', start).lte('scheduled_at', end);
  if (error) throw error;
  const appointments = data ?? [];
  const total = appointments.length;
  const count = (status: string) => appointments.filter((item) => item.status === status).length;
  const completed = count('completed');
  const cancelled = count('cancelled');
  const noShow = count('no_show');
  const delays = appointments.map((item) => new Date(item.scheduled_at).getTime() - new Date(item.created_at).getTime()).filter((value) => value >= 0);
  const providers = new Map<string, number>();
  appointments.forEach((item) => providers.set(item.provider_id ?? 'unassigned', (providers.get(item.provider_id ?? 'unassigned') ?? 0) + 1));
  return {
    appointmentsToday: total,
    completionRate: total ? completed / total : 0,
    cancellationRate: total ? cancelled / total : 0,
    noShowRate: total ? noShow / total : 0,
    averageBookingDelayMinutes: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length / 60_000 : 0,
    providerUtilization: Object.fromEntries(providers),
  };
}
