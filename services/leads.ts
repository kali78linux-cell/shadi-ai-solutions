import { supabase } from '@/lib/supabaseClient';
import type { Lead } from '@/types/lead';

export async function getLeads(): Promise<Lead[]> {
  const { data, error } = await supabase.from('leads').select('*').order('id', { ascending: false }).limit(50);
  if (error) {
    throw error;
  }
  return data ?? [];
}

export async function createLead(lead: Omit<Lead, 'id'>): Promise<Lead> {
  const { data, error } = await supabase.from('leads').insert([lead]).select();
  if (error) {
    throw error;
  }
  return data?.[0] as Lead;
}
