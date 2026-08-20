import { SupabaseClient } from '@supabase/supabase-js';

type Patient = {
  id: string;
  clinic_id: string;
  full_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

type PatientInsert = Partial<Patient> & { clinic_id: string; full_name?: string | null; phone_number?: string | null; email?: string | null; date_of_birth?: string | null; metadata?: Record<string, unknown> | null; };
type PatientUpdate = Partial<Patient>;

export async function getPatients(
  supabase: SupabaseClient<any>,
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
  supabase: SupabaseClient<any>,
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
  supabase: SupabaseClient<any>,
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
  supabase: SupabaseClient<any>,
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
  supabase: SupabaseClient<any>,
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