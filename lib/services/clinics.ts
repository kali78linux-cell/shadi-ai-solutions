import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Clinic } from '@/types/clinic';

export async function getActiveClinic(userId: string): Promise<Clinic | null> {
  // For now, the "active" clinic is the first one the user is a member of.
  // This could be extended to support a "last used" or "preferred" clinic.
  const { data: clinicUserData, error: clinicUserError } = await supabaseAdmin
    .from('clinic_users')
    .select('clinic_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (clinicUserError || !clinicUserData) {
    return null;
  }

  return getClinicById(clinicUserData.clinic_id);
}

export async function getClinicById(id: string): Promise<Clinic | null> {
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Clinic | null;
}

export async function createClinic(clinic: Omit<Clinic, 'id' | 'created_at'>): Promise<Clinic> {
  const { data, error } = await supabaseAdmin.from('clinics').insert([clinic]).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Clinic;
}
