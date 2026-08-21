import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { FOUNDING_SLOTS_TOTAL } from '@/lib/landing/landing-copy';

const registerSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  clinic_name: z.string().min(1).max(200),
  clinic_slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
});

/**
 * Server-side clinic registration.
 *
 * Previously client-side `supabase.auth.signUp()` was used, but the remote
 * Supabase project has email confirmation ENABLED. An unconfirmed signUp
 * returns NO session (and NO access_token), which caused the register page
 * to abort before this route was ever called — leaving users with an auth
 * account but NO clinic, NO clinic_users membership, and NO dashboard access.
 *
 * Fix: create the auth user here with `email_confirm: true` (service-role,
 * server-only) so every registered doctor deterministically gets:
 *   1. an auth.users row (confirmed → can log in immediately)
 *   2. a `clinics` row
 *   3. a `clinic_users` owner membership
 *
 * Founding-members offer: if fewer than FOUNDING_SLOTS_TOTAL clinics are
 * already founding members, this new clinic locks the founding price
 * (is_founding_member=true, founding_price_locked_at=now()).
 *
 * Rollback: if clinic or membership creation fails, the created auth user is
 * deleted so no half-registered accounts remain.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid registration payload', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { email, password, clinic_name, clinic_slug } = parsed.data;

    // Check slug uniqueness before creating anything
    const { data: existingClinic } = await supabaseAdmin
      .from('clinics')
      .select('id')
      .eq('slug', clinic_slug)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingClinic) {
      return NextResponse.json(
        { error: 'This clinic URL is already taken. Please choose another.' },
        { status: 409 }
      );
    }

    // Create the auth user — confirmed so login works immediately,
    // regardless of the remote project's email-confirmation setting.
    const { data: created, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createUserError) {
      // Clean duplicate-email error
      if (createUserError.message.toLowerCase().includes('already registered')) {
        return NextResponse.json(
          { error: 'This email is already registered. Please log in.' },
          { status: 409 }
        );
      }
      throw new Error(createUserError.message);
    }

    const userId = created.user.id;

    try {
      // Founding-members offer: if fewer than FOUNDING_SLOTS_TOTAL clinics are
      // already founding members, this new clinic locks the founding price.
      // The `is_founding_member` column comes from migration
      // db/migrations/20260821_founding_member_clinics.sql. If the column is
      // not present yet (migration not applied) we safely skip the check and
      // leave the defaults (is_founding_member=false).
      let isFoundingMember = false;
      let foundingPriceLockedAt: string | null = null;
      try {
        const { count, error: countErr } = await supabaseAdmin
          .from('clinics')
          .select('id', { count: 'exact', head: true })
          .eq('is_founding_member', true)
          .is('deleted_at', null);
        if (!countErr && (count ?? 0) < FOUNDING_SLOTS_TOTAL) {
          isFoundingMember = true;
          foundingPriceLockedAt = new Date().toISOString();
        }
      } catch {
        // Ignore — if the column doesn't exist, fall back to non-founding.
      }

      // Create the clinic. If the founding-member columns are not yet present
      // (migration 20260821 not applied), the insert falls back to the base
      // columns so registration is never blocked by the migration state.
      interface ClinicRow {
        id: string;
        name: string;
        slug: string;
      }
      let clinic: ClinicRow | null = null;
      let clinicError: { message: string } | null = null;

      const foundingInsert = await supabaseAdmin
        .from('clinics')
        .insert({
          name: clinic_name,
          slug: clinic_slug,
          settings: { timezone: 'Asia/Jerusalem', default_appointment_duration_minutes: 30 },
          is_founding_member: isFoundingMember,
          founding_price_locked_at: foundingPriceLockedAt,
        })
        .select('id, name, slug')
        .single();

      if (foundingInsert.error && /does not exist|could not find/i.test(foundingInsert.error.message)) {
        const baseInsert = await supabaseAdmin
          .from('clinics')
          .insert({
            name: clinic_name,
            slug: clinic_slug,
            settings: { timezone: 'Asia/Jerusalem', default_appointment_duration_minutes: 30 },
          })
          .select('id, name, slug')
          .single();
        clinic = baseInsert.data;
        clinicError = baseInsert.error;
      } else {
        clinic = foundingInsert.data;
        clinicError = foundingInsert.error;
      }

      if (clinicError) throw new Error(clinicError.message);

      // Create owner membership
      const { error: memberError } = await supabaseAdmin.from('clinic_users').insert({
        clinic_id: clinic.id,
        user_id: userId,
        role: 'owner',
      });
      if (memberError) throw new Error(memberError.message);

      logEvent('clinic_registered', { clinic_id: clinic.id, user_id: userId });
      return NextResponse.json({ data: clinic }, { status: 201 });
    } catch (err) {
      // Rollback: remove the created auth user so no orphaned account remains
      const message = err instanceof Error ? err.message : String(err);
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollbackError) {
        logEvent('auth_register_rollback_failed', {
          user_id: userId,
          error: rollbackError.message,
        }, 'error');
      }
      throw new Error(message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('auth_register_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}