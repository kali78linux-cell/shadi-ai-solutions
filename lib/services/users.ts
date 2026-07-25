import { supabaseServer } from '@/lib/supabase/server';
import type { UserProfile } from '@/types/user';

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabaseServer
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as UserProfile | null;
}
