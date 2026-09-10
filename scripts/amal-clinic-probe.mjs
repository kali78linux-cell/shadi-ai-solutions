/** Probe amal-clinic current state (read-only). */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: c } = await sb.from('clinics').select('id, slug, name, activity_type, settings').eq('slug', 'amal-clinic').maybeSingle();
console.log('clinic:', c?.id, c?.name, c?.activity_type);
if (!c) process.exit(0);
const cid = c.id;
const q = async (t, s) => (await sb.from(t).select(s).eq('clinic_id', cid)).data?.length;
console.log('services:', await q('clinic_services', 'id'));
console.log('schedules:', await q('provider_schedules', 'id'));
console.log('providers:', (await sb.from('providers').select('id,name,public_slug').eq('clinic_id', cid)).data);
console.log('media:', await q('clinic_public_media', 'id'));
console.log('achievements:', await q('clinic_achievements', 'id'));
console.log('testimonials:', await q('clinic_testimonials', 'id'));
console.log('articles:', await q('clinic_articles', 'id'));
const pp = c.settings?.public_profile;
console.log('public_profile keys:', pp ? Object.keys(pp).join(',') : 'NONE');
console.log('cover:', pp?.cover_url, 'logo:', pp?.logo_url);
console.log('sections:', JSON.stringify(pp?.sections ?? null));
const { data: subs } = await sb.from('subscriptions').select('status').eq('clinic_id', cid).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1);
console.log('subscription:', subs?.[0]?.status ?? 'none');
const { data: users } = await sb.from('clinic_users').select('user_id, role').eq('clinic_id', cid).is('deleted_at', null);
console.log('clinic_users:', users);
const { data: settings } = await sb.from('clinic_settings').select('timezone, currency').eq('clinic_id', cid).maybeSingle();
console.log('settings:', settings);
