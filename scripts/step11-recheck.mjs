import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const stamp = Date.now(), email=`e2e-11r-${stamp}@test-delete.local`, slug=`e2e-11r-${stamp}`;
const NAME = `مساعد ريتشك ${stamp % 1000}`;
const created={clinicId:null,providerIds:[],convIds:[]}; const results=[];
const check=(n,ok,x='')=>results.push(`${ok?'PASS':'FAIL'} ${n}${x?' — '+x:''}`);
const j=async r=>r.json().catch(()=>null);
const reg=await j(await fetch(`${BASE}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'TestPass!234',clinic_name:'ريتشك ستيب11',clinic_slug:slug})}));
created.clinicId=reg?.data?.id; if(!created.clinicId) throw new Error('no clinic');
const {data:sess}=await anon.auth.signInWithPassword({email,password:'TestPass!234'});
const AUTH={authorization:`Bearer ${sess.session.access_token}`,'content-type':'application/json'};
const CID=created.clinicId;
// S7: PUT provider returns updated row; list reflects it
const p1=await j(await fetch(`${BASE}/api/clinic/providers?clinic_id=${CID}`,{method:'POST',headers:AUTH,body:JSON.stringify({name:'د. ريتشك',title:'طبيب',provider_type:'dentist'})}));
if(p1?.data?.id) created.providerIds.push(p1.data.id);
const upd=await j(await fetch(`${BASE}/api/clinic/providers/${p1.data.id}?clinic_id=${CID}`,{method:'PUT',headers:AUTH,body:JSON.stringify({title:'أخصائي جديد'})}));
check('S7 PUT returns updated title', upd?.data?.title==='أخصائي جديد', `got=${upd?.data?.title}`);
const list=await j(await fetch(`${BASE}/api/clinic/providers?clinic_id=${CID}`,{headers:{authorization:AUTH.authorization}}));
const found=(list?.data??[]).find(p=>p.id===p1.data.id);
check('S7 title reflected in list GET', found?.title==='أخصائي جديد', `got=${found?.title}`);
// S10: set assistant_name, start new conversation, read assistant_message + history
await j(await fetch(`${BASE}/api/clinic/ai-settings?clinic_id=${CID}`,{method:'PUT',headers:AUTH,body:JSON.stringify({assistant_name:NAME,greeting:'أهلا'})}));
const m=await fetch(`${BASE}/api/public/ai/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clinic_slug:slug,text:'ما اسمك أيها المساعد؟'})});
const mb=await j(m);
check('S10 HTTP 200', m.status===200, `status=${m.status}`);
if(mb?.conversation_id) created.convIds.push(mb.conversation_id);
check('S10 conversation_id present', Boolean(mb?.conversation_id));
const reply=String(mb?.assistant_message??'');
check('S10 assistant_name in reply', reply.includes(NAME), `reply="${reply.slice(0,90)}"`);
const h=await j(await fetch(`${BASE}/api/public/ai/messages?clinic_slug=${slug}&conversation_id=${mb?.conversation_id}`));
check('S10 history persisted (public GET)', Array.isArray(h?.data)&&h.data.length>=2, `n=${h?.data?.length}`);
console.log(results.join('\n'));
await admin.from('provider_schedules').delete().eq('clinic_id',CID).in('provider_id',created.providerIds);
await admin.from('providers').delete().eq('clinic_id',CID).in('id',created.providerIds);
for(const cid2 of created.convIds){await admin.from('messages').delete().eq('conversation_id',cid2).eq('clinic_id',CID);await admin.from('conversations').delete().eq('id',cid2).eq('clinic_id',CID);}
await admin.from('clinic_ai_settings').delete().eq('clinic_id',CID);
await admin.from('clinic_users').delete().eq('clinic_id',CID);
await admin.from('clinics').delete().eq('id',CID);
if(created.clinicId){const {data:users}=await admin.auth.admin.listUsers({perPage:200});const o=users.users.find(u=>u.email===email);if(o) await admin.auth.admin.deleteUser(o.id);}
const v=async c=> (await admin.from('clinics').select('id',{count:'exact',head:true}).eq('id',CID)).count??0;
console.log('RECHECK_CLEANUP clinic_rows='+await v());
process.exit(0);
