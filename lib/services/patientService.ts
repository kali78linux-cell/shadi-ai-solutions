import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/db';

type Patient = Database['public']['Tables']['patients']['Row'];
type PatientInsert = Database['public']['Tables']['patients']['Insert'];
type PatientUpdate = Database['public']['Tables']['patients']['Update'];

export async function getPatients(
  supabase: SupabaseClient<Database>,
  { clinicId, searchQuery }: { clinicId: string; searchQuery?: string | null }
) {
  let query = supabase
    .from('patients')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false });

  if (searchQuery) {
    query = query.or(
      `full_name.ilike.%${searchQuery}%,phone_number.ilike.%${searchQuery}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching patients:', error);
    throw error;
  }

  return data;
}

export async function getPatientById(
  supabase: SupabaseClient<Database>,
  { patientId, clinicId }: { patientId: string; clinicId: string }
): Promise<Patient | null> {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    console.error('Error fetching patient by ID:', error);
    throw error;
  }

  return data;
}

export async function createPatient(
  supabase: SupabaseClient<Database>,
  patientData: Omit<PatientInsert, 'id' | 'created_at' | 'clinic_id'>,
  clinicId: string
): Promise<Patient> {
  const { data, error } = await supabase
    .from('patients')
    .insert({ ...patientData, clinic_id: clinicId })
    .select()
    .single();

  if (error) {
    console.error('Error creating patient:', error);
    throw error;
  }

  return data;
}

export async function updatePatient(
  supabase: SupabaseClient<Database>,
  { patientId, clinicId, updateData }: { patientId: string; clinicId: string; updateData: PatientUpdate }
): Promise<Patient> {
  const { data, error } = await supabase
    .from('patients')
    .update(updateData)
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .select()
    .single();

  if (error) {
    console.error('Error updating patient:', error);
    throw error;
  }

  return data;
}

export async function deletePatient(
  supabase: SupabaseClient<Database>,
  { patientId, clinicId }: { patientId: string; clinicId: string }
) {
  const { error } = await supabase
    .from('patients')
    .delete()
    .eq('id', patientId)
    .eq('clinic_id', clinicId);

  if (error) {
    console.error('Error deleting patient:', error);
    throw error;
  }

  return { success: true };
}