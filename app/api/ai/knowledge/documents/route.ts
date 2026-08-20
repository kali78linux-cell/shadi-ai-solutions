import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(request, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('clinic_knowledge_documents')
      .select('*')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ documents: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logEvent('knowledge_documents_get_error', { error: message }, 'error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const clinicId = url.searchParams.get('clinic_id');
    const documentId = url.pathname.split('/').filter(Boolean).pop();
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!documentId) return NextResponse.json({ error: 'Document id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(request, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { error } = await supabase
      .from('clinic_knowledge_documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('clinic_id', clinicId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logEvent('knowledge_documents_delete_error', { error: message }, 'error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const clinicId = url.searchParams.get('clinic_id');
    const documentId = url.pathname.split('/').filter(Boolean).pop();
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!documentId) return NextResponse.json({ error: 'Document id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(request, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('clinic_knowledge_documents')
      .select('*')
      .eq('id', documentId)
      .eq('clinic_id', clinicId)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const { error: updateError } = await supabase
      .from('clinic_knowledge_documents')
      .update({ processing_status: 'pending' })
      .eq('id', documentId)
      .eq('clinic_id', clinicId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ document: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logEvent('knowledge_documents_reindex_error', { error: message }, 'error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}