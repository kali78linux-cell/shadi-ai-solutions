import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const BASE='http://localhost:3111';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const projectRef=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const stamp=Date.now(),email=`e2e-11ud-${stamp}@test-delete.local`,slug=`e2e-11ud-${stamp}`;
const reg=await fetch(`${BASE}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'TestPass!234',clinic_name:'ud',clinic_slug:slug})});
const rb=await reg.json().catch(()=>null); const CID=rb?.data?.id;
const {data:sess}=await anon.auth.signInWithPassword({email,password:'TestPass!234'});
const s=sess.session;
const cookie=`${projectRef}-auth-token=${Buffer.from(JSON.stringify({access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at,expires_in:3600,token_type:'bearer',user:s.user})).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
for(const p of ['/dashboard','/dashboard/providers','/dashboard/ai-settings','/dashboard/overview']){
  const r=await fetch(`${BASE}${p}`,{headers:{Cookie:cookie},redirect:'manual'});
  const t=await r.text();
  fs.writeFileSync(`/tmp/ui-dump${p.replace(/\//g,'_')}.html`,t);
  console.log(`${p} status=${r.status} loc=${(r.headers.get('location')??'').slice(0,60)} len=${t.length}`);
  for(const probe of ['\u0625\u0636\u0627\u0641\u0629','إضافة','assistant','dashboard/overview','أطباء','الخدمات','Provider', 'login']){
    if(t.includes(probe)){ console.log(`   contains: ${JSON.stringify(probe)}`); }
  }
}
if(CID){await admin.from('clinic_users').delete().eq('clinic_id',CID);await admin.from('clinics').delete().eq('id',CID);}
const {data:users}=await admin.auth.admin.listUsers({perPage:200});const o=users.users.find(u=>u.email===email);if(o) await admin.auth.admin.deleteUser(o.id);
process.exit(0);
