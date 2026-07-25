// app/api/knowledge/upload/route.ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ingestDocument } from '@/lib/services/knowledgeService';
import { NextResponse } from 'next/server';
import { getActiveClinic } from '@/lib/services/clinics';

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const activeClinic = await getActiveClinic(user.id);
  if (!activeClinic) {
    return NextResponse.json({ error: 'No active clinic found' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalFilename = file.name;

    const document = await ingestDocument(activeClinic.id, user.id, buffer, originalFilename);

    return NextResponse.json(document);
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
  }
}
