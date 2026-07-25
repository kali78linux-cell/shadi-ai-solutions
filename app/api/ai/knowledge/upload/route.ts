import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { KnowledgeService } from '@/lib/services/knowledgeService';

// Assuming a helper exists to get the active clinic ID from the user's session/claims
async function getActiveClinicId(userId: string, supabase: any): Promise<string | null> {
  const { data, error } = await supabase.from('clinic_users').select('clinic_id').eq('user_id', userId).limit(1).single();
  return data?.clinic_id ?? null;
}

export async function POST(request: Request) {
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

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clinicId = await getActiveClinicId(session.user.id, supabase);
    if (!clinicId) {
      return NextResponse.json({ error: 'No active clinic found.' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const knowledgeService = new KnowledgeService(supabase);
    const document = await knowledgeService.handleUpload({ file, clinicId, userId: session.user.id });

    return NextResponse.json({ message: 'Upload successful, processing started.', document });
  } catch (error) {
    console.error('Upload API error:', error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 });
  }
}