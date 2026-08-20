import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Appointment } from '@/types/appointment';

export async function getAppointments(clinicId?: string): Promise<Appointment[]> {
  const supabaseServer = createSupabaseServerClient();
  const query = supabaseServer.from('appointments').select('*').order('id', { ascending: false }).limit(50);
  const { data, error } = clinicId ? await query.eq('clinic_id', clinicId) : await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Appointment[];
}

export async function createAppointment(appointment: Omit<Appointment, 'id'>): Promise<Appointment> {
  const supabaseServer = createSupabaseServerClient();
  const { data, error } = await supabaseServer.from('appointments').insert([appointment]).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Appointment;
}
