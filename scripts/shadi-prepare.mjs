// Read-only diagnosis + minimal Shadi Nouri readiness fix.
// - Re-activates the existing provider record (clears deleted_at if it belongs to the clinic).
// - Creates the provider_services assignment (provider <-> active service) if missing.
// - Creates an enabling clinic_ai_settings row if absent.
// Never creates an appointment, patient, or demo/fake record.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || url.includes('example') || url.includes('placeholder')) { console.log('BLOCKED'); process.exit(1); }
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const CID = '7fe17ccd-8185-407a-8ec4-33bf6e357c2d'; // Shadi Nouri
const PROVIDER_ID = '05db27bf-5c31-4565-8cbd-4441a28066ac'; // existing Khaled Jamal provider
const SERVICE_ID = 'e66bd813-d617-4aa0-9f22-53741c2fc499'; // "سحب عصب سن"

async function state(label, fn) {
  const r = await fn();
  console.log(`\n[${label}]`);
  if (r.error) console.log('  ERROR:', r.error.message);
  else console.log('  ', JSON.stringify(r.data ?? [], null, 2));
}

// --- READ current state ---
await state('clinic_users', () => admin.from('clinic_users').select('clinic_id,user_id,role,deleted_at').eq('clinic_id', CID));
await state('providers (all for clinic)', () => admin.from('providers').select('id,name,title,provider_type,deleted_at,created_at').eq('clinic_id', CID));
await state('services (all for clinic)', () => admin.from('clinic_services').select('id,name,description,duration_minutes,price,active,deleted_at').eq('clinic_id', CID));
await state('provider_schedules', () => admin.from('provider_schedules').select('provider_id,weekday,enabled,start_time,end_time,max_appointments_per_day').eq('clinic_id', CID));
await state('provider_services (before)', () => admin.from('provider_services').select('provider_id,service_id').eq('clinic_id', CID));
await state('clinic_ai_settings (before)', () => admin.from('clinic_ai_settings').select('clinic_id,assistant_name,language,lead_detection_enabled,appointment_booking_enabled,knowledge_retrieval_enabled,show_service_prices_to_patients,deleted_at').eq('clinic_id', CID));

// --- APPLY minimal readiness fixes ---
// 1) Re-activate the existing provider if it belongs to this clinic and is soft-deleted.
{
  const { data, error } = await admin.from('providers').select('id,deleted_at,clinic_id').eq('id', PROVIDER_ID).eq('clinic_id', CID).single();
  if (error) console.log('\n[activate provider] SKIP - not found:', error.message);
  else if (!data.deleted_at) console.log('\n[activate provider] already active (deleted_at null).');
  else {
    const up = await admin.from('providers').update({ deleted_at: null }).eq('id', PROVIDER_ID).eq('clinic_id', CID).select('id,name,title,deleted_at').single();
    if (up.error) console.log('\n[activate provider] FAILED:', up.error.message);
    else console.log('\n[activate provider] RE-ACTIVATED:', JSON.stringify(up.data));
  }
}

// 2) Create the provider-service assignment if missing.
{
  const { data, error } = await admin.from('provider_services').select('provider_id').eq('clinic_id', CID).eq('provider_id', PROVIDER_ID).eq('service_id', SERVICE_ID);
  if (error) console.log('\n[assign service] ERROR (query):', error.message);
  else if (data && data.length) console.log('\n[assign service] already assigned.');
  else {
    // verify service belongs to clinic and is active before linking
    const svc = await admin.from('clinic_services').select('id,active,deleted_at').eq('id', SERVICE_ID).eq('clinic_id', CID).single();
    if (svc.error || !svc.data || !svc.data.active || svc.data.deleted_at) {
      console.log('\n[assign service] SKIP — service not active/belongs to clinic.');
    } else {
      const ins = await admin.from('provider_services').insert([{ clinic_id: CID, provider_id: PROVIDER_ID, service_id: SERVICE_ID }]).select('provider_id,service_id');
      if (ins.error) console.log('\n[assign service] ERROR:', ins.error.message);
      else console.log('\n[assign service] ASSIGNED:', JSON.stringify(ins.data));
    }
  }
}

// 3) Enable AI settings (create one row only if absent) — no secrets, just enable flags + Arabic.
{
  const { data, error } = await admin.from('clinic_ai_settings').select('id').eq('clinic_id', CID).is('deleted_at', null).maybeSingle();
  if (error) console.log('\n[ai settings] ERROR:', error.message);
  else if (data) console.log('\n[ai settings] already exists.'); // don't overwrite owner config
  else {
    const ins = await admin.from('clinic_ai_settings').insert({
      clinic_id: CID,
      assistant_name: 'مساعد عيادة شادي نوري',
      language: 'ar',
      lead_detection_enabled: true,
      appointment_booking_enabled: true,
      knowledge_retrieval_enabled: true,
      show_service_prices_to_patients: false,
    }).select('clinic_id,assistant_name,language');
    if (ins.error) console.log('\n[ai settings] ERROR:', ins.error.message);
    else console.log('\n[ai settings] ENABLED:', JSON.stringify(ins.data));
  }
}

console.log('\n--- AFTER ---');
await state('providers (after)', () => admin.from('providers').select('id,name,title,deleted_at').eq('clinic_id', CID));
await state('provider_services (after)', () => admin.from('provider_services').select('provider_id,service_id').eq('clinic_id', CID));
await state('clinic_ai_settings (after)', () => admin.from('clinic_ai_settings').select('clinic_id,assistant_name,language,lead_detection_enabled,appointment_booking_enabled,knowledge_retrieval_enabled,show_service_prices_to_patients,deleted_at').eq('clinic_id', CID));
console.log('\nDONE');
process.exit(0);