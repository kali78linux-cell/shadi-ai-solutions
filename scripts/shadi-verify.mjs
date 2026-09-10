// Read-only verification that Shadi Nouri is now ready for the first real journey.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const l = c.split('\n').find((x) => x.startsWith(k + '='));
  return l ? l.split('=').slice(1).join('=').trim() : '';
};
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const key = get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || url.includes('example')) { console.log('BLOCKED'); process.exit(1); }
const a = createClient(url, key, { auth: { persistSession: false } });
const CID = '7fe17ccd-8185-407a-8ec4-33bf6e357c2d';

const prov = await a.from('providers').select('id,name,title').eq('clinic_id', CID).is('deleted_at', null);
const svc = await a.from('clinic_services').select('id,name,active').eq('clinic_id', CID).eq('active', true).is('deleted_at', null);
const sch = await a.from('provider_schedules').select('provider_id').eq('clinic_id', CID).eq('enabled', true);
const asg = await a.from('provider_services').select('provider_id,service_id').eq('clinic_id', CID);
const ai = await a.from('clinic_ai_settings').select('lead_detection_enabled,appointment_booking_enabled,knowledge_retrieval_enabled').eq('clinic_id', CID).is('deleted_at', null).maybeSingle();
const clinic = await a.from('clinics').select('name,phone,address,website').eq('id', CID).single();

console.log('ACTIVE_PROVIDERS=' + JSON.stringify(prov.data ?? []));
console.log('ACTIVE_SERVICES=' + JSON.stringify(svc.data ?? []));
console.log('ENABLED_SCHEDULES_COUNT=' + (sch.data?.length ?? 0));
console.log('ASSIGNMENTS=' + JSON.stringify(asg.data ?? []));
console.log('AI_SETTINGS=' + JSON.stringify(ai.data ?? null));
console.log('CLINIC_PROFILE=' + (clinic.error ? ('ERR ' + clinic.error.message) : JSON.stringify(clinic.data)));
console.log('GEMINI_KEY_PRESENT=' + Boolean(get('GEMINI_API_KEY') && !get('GEMINI_API_KEY').includes('your-')));
// Does the engine's active-provider path now include Khalid for this service?
const activeProviderIds = (prov.data ?? []).map((p) => p.id);
const assignedToService = (asg.data ?? []).filter((r) => activeProviderIds.includes(r.provider_id) && (svc.data ?? []).some((s) => s.id === r.service_id));
console.log('ENGINE_RESOLVES_PROVIDER_FOR_SERVICE=' + (assignedToService.length > 0));
process.exit(0);