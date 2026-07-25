import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Assuming a helper exists to get the active clinic ID from the user's session/claims
async function getActiveClinicId(userId: string, supabase: any): Promise<string | null> {
  const { data, error } = await supabase.from('clinic_users').select('clinic_id').eq('user_id', userId).limit(1).single();
  return data?.clinic_id ?? null;
}

export async function GET(request: Request) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clinicId = await getActiveClinicId(session.user.id, supabase);
    if (!clinicId) return NextResponse.json({ error: 'No active clinic found.' }, { status: 401 });

    const { data, error } = await supabase.from('clinic_knowledge_documents').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ documents: data });
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch documents: ${error instanceof Error ? error.message : 'Unknown error'}` }, { status: 500 });
  }
}