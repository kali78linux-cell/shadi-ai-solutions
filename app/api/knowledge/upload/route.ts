// app/api/knowledge/upload/route.ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { KnowledgeService } from '@/lib/services/knowledgeService';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Look up the user's active clinic using the same server-side client.
  const { data: clinicUserData, error: clinicUserError } = await supabase
    .from('clinic_users')
    .select('clinic_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (clinicUserError || !clinicUserData) {
    return NextResponse.json({ error: 'No active clinic found.' }, { status: 401 });
  }

  const clinicId = clinicUserData.clinic_id;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const knowledgeService = new KnowledgeService(supabase);
    const document = await knowledgeService.handleUpload({ file, clinicId, userId: user.id });

    return NextResponse.json({ message: 'Upload successful, processing started.', document });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed. Check the file and try again.' }, { status: 500 });
  }
}
