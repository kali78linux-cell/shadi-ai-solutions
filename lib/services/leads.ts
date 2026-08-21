import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Lead } from '@/types/lead';

export async function getLeads(clinicId?: string): Promise<Lead[]> {
  const supabaseServer = createSupabaseServerClient();
  const query = supabaseServer.from('leads').select('*').order('id', { ascending: false }).limit(50);
  const { data, error } = clinicId ? await query.eq('clinic_id', clinicId) : await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead[];
}

/**
 * Create a lead for an AUTHENTICATED clinic member (RLS-enforced).
 * Used by the dashboard/authenticated flows.
 */
export async function createLead(lead: Omit<Lead, 'id'>): Promise<Lead> {
  const supabaseServer = createSupabaseServerClient();
  const { data, error } = await supabaseServer.from('leads').insert([lead]).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead;
}

/**
 * Create a PUBLIC landing-page lead (e.g. founding-members offer).
 *
 * SECURITY:
 * - Uses the server-side service-role client (supabaseAdmin) so RLS does not
 *   block the anonymous visitor. Service-role stays SERVER ONLY — never exposed
 *   to the browser.
 * - `clinic_id` is ALWAYS forced to null for this public source. The caller
 *   cannot choose an arbitrary clinic_id (prevents anonymous assignment to a
 *   clinic).
 * - The route must validate the payload with Zod BEFORE calling this.
 */
export async function createPublicLead(input: {
  name: string;
  email: string;
  phone: string;
  source: string;
}): Promise<Lead> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert([
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        source: input.source,
        status: 'new',
        clinic_id: null, // forced NULL — never trust a client-supplied clinic_id
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead;
}