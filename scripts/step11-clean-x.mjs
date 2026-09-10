import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const r1=await admin.from('clinics').select('id').eq('slug','x-probe-remove-1').maybeSingle();
if(r1.data){await admin.from('clinic_users').delete().eq('clinic_id',r1.data.id);await admin.from('clinics').delete().eq('id',r1.data.id);console.log('x-probe clinic cleaned');}
const {data:users}=await admin.auth.admin.listUsers({perPage:200});
const o=users.users.find(u=>u.email==='x-probe-remove@test-delete.local'); if(o){await admin.auth.admin.deleteUser(o.id);console.log('x-probe user removed');}
process.exit(0);
