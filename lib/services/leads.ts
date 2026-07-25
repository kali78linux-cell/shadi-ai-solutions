import { supabaseServer } from '@/lib/supabase/server';
import type { Lead } from '@/types/lead';

export async function getLeads(clinicId?: string): Promise<Lead[]> {
  const query = supabaseServer.from('leads').select('*').order('id', { ascending: false }).limit(50);
  const { data, error } = clinicId ? await query.eq('clinic_id', clinicId) : await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead[];
}

export async function createLead(lead: Omit<Lead, 'id'>): Promise<Lead> {
  const { data, error } = await supabaseServer.from('leads').insert([lead]).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead;
}
