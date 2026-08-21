import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getLeads, createLead, createPublicLead } from '@/lib/services/leads';
import { getSupabaseEnvConfig } from '@/lib/config';

let demoLeads = [
  {
    id: 1,
    name: 'منى خالد',
    email: 'mona@example.com',
    phone: '+966500000001',
    source: 'موقع الويب',
    status: 'جديد',
  },
  {
    id: 2,
    name: 'خالد سعيد',
    email: 'khaled@example.com',
    phone: '+966500000002',
    source: 'الهاتف',
    status: 'قيد المتابعة',
  },
];
let nextLeadId = demoLeads.length + 1;

// ─── Public landing-page lead schema (strict) ───
// Only the founding-members offer source is allowed from the public landing page.
// clinic_id is NOT accepted here — it is always forced to null server-side.
const publicLeadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name is too long'),
  email: z.string().trim().email('A valid email is required').max(254, 'Email is too long'),
  phone: z.string().trim().min(6, 'Phone is required').max(30, 'Phone is too long'),
  source: z.literal('landing_page_founding_offer'),
});

type PublicLeadInput = {
  name: string;
  email: string;
  phone: string;
  source: 'landing_page_founding_offer';
};

export async function GET() {
  const config = getSupabaseEnvConfig();

  if (!config.isConfigured) {
    return NextResponse.json(demoLeads);
  }

  try {
    const data = await getLeads();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const config = getSupabaseEnvConfig();

  if (!config.isConfigured) {
    const body = await request.json();
    const nextLead = { id: nextLeadId++, ...body };
    demoLeads = [nextLead, ...demoLeads];
    return NextResponse.json(nextLead);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ─── Public landing-page lead path ───
  // If the payload looks like a landing-page founding offer, validate strictly
  // and insert via the server-side service-role path (clinic_id forced NULL).
  if (body && typeof body === 'object' && 'source' in body && (body as { source?: unknown }).source === 'landing_page_founding_offer') {
    const parsed = publicLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid lead payload', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    try {
      const lead = await createPublicLead(parsed.data as unknown as PublicLeadInput);
      // Never return internal DB fields to the public client.
      return NextResponse.json(
        { id: lead.id, name: lead.name, email: lead.email, phone: lead.phone, source: lead.source, status: lead.status },
        { status: 201 }
      );
    } catch (error) {
      return NextResponse.json({ error: 'Unable to save your request. Please try again.' }, { status: 500 });
    }
  }

  // ─── Authenticated clinic-member lead path (RLS-enforced) ───
  try {
    const lead = await createLead(body as never);
    return NextResponse.json(lead);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}