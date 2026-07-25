import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

type SupabaseUser = {
  id: string;
  email: string | null;
};

export type ClinicMembership = {
  clinic_id: string;
  role: 'owner' | 'admin' | 'receptionist';
  clinic?: {
    name: string;
    slug: string;
  };
};

export function getBearerToken(request: NextRequest): string {
  const authorizationHeader = request.headers.get('authorization') ?? '';
  const token = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.replace('Bearer ', '').trim()
    : '';

  if (!token) {
    throw new Error('Missing Authorization header.');
  }

  return token;
}

export async function getUserFromToken(accessToken: string): Promise<SupabaseUser> {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new Error(error?.message || 'Unable to verify user token.');
  }

  return {
    id: data.user.id,
    email: data.user.email,
  };
}

export async function getCurrentUser(request: NextRequest): Promise<SupabaseUser> {
  const accessToken = getBearerToken(request);
  return getUserFromToken(accessToken);
}

export async function getPrimaryClinicMembership(userId: string): Promise<ClinicMembership | null> {
  const { data, error } = await supabaseAdmin
    .from('clinic_users')
    .select('clinic_id, role, clinics(name, slug)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ClinicMembership | null;
}
