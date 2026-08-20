import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { getSupabaseEnvConfig } from '@/lib/config';

async function getActiveClinicId(userId: string, client: any): Promise<string | null> {
  const { data, error } = await client.from('clinic_users').select('clinic_id').eq('user_id', userId).is('deleted_at', null).limit(1).single();
  if (error || !data) return null;
  return data.clinic_id ?? null;
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const documentId = url.pathname.split('/').filter(Boolean).pop();

  if (!documentId) {
    return NextResponse.json({ error: 'Document id is required' }, { status: 400 });
  }

  const config = getSupabaseEnvConfig();
  if (!config.supabaseUrl || !config.anonKey || !config.serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration error: Supabase is not fully configured.' }, { status: 503 });
  }

  const cookieStore = cookies();
  const serverClient = createServerClient(
    config.supabaseUrl,
    config.anonKey,
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
    const { data: { session } } = await serverClient.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clinicId = await getActiveClinicId(session.user.id, serverClient);
    if (!clinicId) {
      return NextResponse.json({ error: 'No active clinic found.' }, { status: 401 });
    }

    const { error } = await serverClient.from('clinic_knowledge_documents').update({ deleted_at: new Date().toISOString() }).eq('id', documentId).eq('clinic_id', clinicId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const documentId = url.pathname.split('/').filter(Boolean).pop();

  if (!documentId) {
    return NextResponse.json({ error: 'Document id is required' }, { status: 400 });
  }

  const config = getSupabaseEnvConfig();
  if (!config.supabaseUrl || !config.anonKey || !config.serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration error: Supabase is not fully configured.' }, { status: 503 });
  }

  const cookieStore = cookies();
  const serverClient = createServerClient(
    config.supabaseUrl,
    config.anonKey,
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
    const { data: { session } } = await serverClient.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clinicId = await getActiveClinicId(session.user.id, serverClient);
    if (!clinicId) {
      return NextResponse.json({ error: 'No active clinic found.' }, { status: 401 });
    }

    const { data, error } = await serverClient.from('clinic_knowledge_documents').select('*').eq('id', documentId).eq('clinic_id', clinicId).single();
    if (error || !data) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { error: updateError } = await serverClient.from('clinic_knowledge_documents').update({ processing_status: 'pending' }).eq('id', documentId).eq('clinic_id', clinicId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ document: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
