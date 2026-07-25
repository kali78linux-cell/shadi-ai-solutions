import { supabase } from '@/lib/supabaseClient';
import type { Appointment } from '@/types/appointment';

export async function getAppointments(): Promise<Appointment[]> {
  const { data, error } = await supabase.from('appointments').select('*').order('id', { ascending: false }).limit(50);
  if (error) {
    throw error;
  }
  return data ?? [];
}

export async function createAppointment(appointment: Omit<Appointment, 'id'>): Promise<Appointment> {
  const { data, error } = await supabase.from('appointments').insert([appointment]).select();
  if (error) {
    throw error;
  }
  return data?.[0] as Appointment;
}
