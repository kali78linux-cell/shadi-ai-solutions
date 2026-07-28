import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/ssr';
import { z } from 'zod';
import * as patientService from '@/lib/services/patientService';
import { Database } from '@/lib/database.types';

// Helper to authorize and get clinic context
async function authorizeAndGetClinic(supabase: ReturnType<typeof createRouteHandlerClient>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: { message: 'Unauthorized', status: 401 } };
  }

  // A user is tied to a clinic via the 'clinic_users' table
  const { data: memberData, error: memberError } = await supabase
    .from('clinic_users')
    .select('clinic_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (memberError || !memberData) {
    return { error: { message: 'Forbidden: User not associated with any clinic.', status: 403 } };
  }

  return { user, clinicId: memberData.clinic_id };
}

// Zod schema for creating a patient. clinic_id is handled by the backend.
const createPatientSchema = z.object({
  full_name: z.string().min(2, 'Full name must be at least 2 characters long.'),
  phone_number: z.string().min(5, 'Phone number is required.'),
  email: z.string().email('Invalid email address.').optional().nullable(),
  date_of_birth: z.string().date('Invalid date format.').optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

export async function GET(req: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient<Database>(cookieStore);
  
  try {
    const { clinicId, error: authError } = await authorizeAndGetClinic(supabase);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: authError.status });
    }

    const url = new URL(req.url);
    const searchQuery = url.searchParams.get('q');

    const patients = await patientService.getPatients(supabase, { clinicId, searchQuery });

    return NextResponse.json(patients);
  } catch (error: any) {
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient<Database>(cookieStore);

  try {
    const { clinicId, error: authError } = await authorizeAndGetClinic(supabase);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: authError.status });
    }

    const body = await req.json();
    const validation = createPatientSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.flatten() }, { status: 400 });
    }

    const newPatient = await patientService.createPatient(supabase, validation.data, clinicId);

    return NextResponse.json(newPatient, { status: 201 });
  } catch (error: any) {
    if (error.code === '23505') { // Supabase/Postgres unique violation code
      return NextResponse.json({ error: 'A patient with this phone number or email already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}