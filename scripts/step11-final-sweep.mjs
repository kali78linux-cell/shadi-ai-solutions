import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const pats=['e2e-11%','x-probe-remove%','rep-%'];
let removed=0;
for(const pat of pats){
  const {data}=await admin.from('clinics').select('id,slug').like('slug',pat);
  for(const c of data||[]){await admin.from('clinic_users').delete().eq('clinic_id',c.id);await admin.from('clinics').delete().eq('id',c.id);removed++;console.log('removed',c.slug);}
}
const {data:users}=await admin.auth.admin.listUsers({perPage:200});
for(const u of users.users.filter(u=>/^(e2e-11|x-probe-remove|rep-)/.test(u.email??''))){await admin.auth.admin.deleteUser(u.id);console.log('user removed',u.email);}
console.log('SWEEP removed_clinics='+removed);
process.exit(0);
