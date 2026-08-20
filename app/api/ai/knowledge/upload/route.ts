import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { KnowledgeService } from '@/lib/services/knowledgeService';
import { logEvent } from '@/lib/server/logging';

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(request, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'AI runtime is not configured. Please provide OPENAI_API_KEY.' }, { status: 503 });
    }

    const knowledgeService = new KnowledgeService(supabaseAdmin);
    const document = await knowledgeService.handleUpload({ file, clinicId, userId: authorization.user.id });

    return NextResponse.json({ message: 'Upload successful, processing started.', document });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    logEvent('knowledge_upload_error', { error: message }, 'error');
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 });
  }
}