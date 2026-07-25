import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestStructured } from '@/lib/services/knowledge/ingestion';
import { supabase } from '@/lib/supabase';

const ItemSchemas = {
  service: z.object({ name: z.string(), description: z.string().optional(), price: z.number().optional(), duration: z.number().optional() }),
  doctor: z.object({ name: z.string(), specialty: z.string().optional(), schedule: z.any().optional() }),
  faq: z.object({ question: z.string(), answer: z.string() }),
};

const bodySchema = z.object({ clinic_id: z.string().uuid(), subtype: z.string(), items: z.array(z.any()), uploaded_by: z.string().optional() });

async function getUserFromAuth(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromAuth(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });

    const { clinic_id, subtype, items, uploaded_by } = parsed.data;

    // membership check
    const { data: member } = await supabase.from('clinic_users').select('role').eq('clinic_id', clinic_id).eq('user_id', user.id).limit(1).single();
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // basic validation per subtype
    if (subtype === 'services') {
      const validated = items.map((it: any) => ItemSchemas.service.parse(it));
      const inserted = await ingestStructured(clinic_id, 'services', validated, uploaded_by || user.id);
      return NextResponse.json({ data: inserted });
    }
    if (subtype === 'doctors') {
      const validated = items.map((it: any) => ItemSchemas.doctor.parse(it));
      const inserted = await ingestStructured(clinic_id, 'doctors', validated, uploaded_by || user.id);
      return NextResponse.json({ data: inserted });
    }
    if (subtype === 'faqs') {
      const validated = items.map((it: any) => ItemSchemas.faq.parse(it));
      const inserted = await ingestStructured(clinic_id, 'faqs', validated, uploaded_by || user.id);
      return NextResponse.json({ data: inserted });
    }

    // fallback: insert generic structured
    const inserted = await ingestStructured(clinic_id, subtype, items, uploaded_by || user.id);
    return NextResponse.json({ data: inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
