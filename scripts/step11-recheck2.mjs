import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const BASE=process.env.BASE??'http://localhost:3111';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const stamp=Date.now(),email=`e2e-11s-${stamp}@test-delete.local`,slug=`e2e-11s-${stamp}`;
const NAME=`مساعد سيب11 ${stamp%1000}`; const created={clinicId:null,convIds:[]}; const results=[];
const check=(n,ok,x)=>results.push(`${ok?'PASS':'FAIL'} ${n}${x?' — '+x:''}`);
const j=async r=>r.json().catch(()=>null);
const reg=await j(await fetch(`${BASE}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'TestPass!234',clinic_name:'سيب11',clinic_slug:slug})}));
created.clinicId=reg?.data?.id;
const {data:sess}=await anon.auth.signInWithPassword({email,password:'TestPass!234'});
const AUTH={authorization:`Bearer ${sess.session.access_token}`,'content-type':'application/json'};
const CID=created.clinicId;
await j(await fetch(`${BASE}/api/clinic/ai-settings?clinic_id=${CID}`,{method:'PUT',headers:AUTH,body:JSON.stringify({assistant_name:NAME,greeting:'أهلا'})}));
const m=await fetch(`${BASE}/api/public/ai/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clinic_slug:slug,text:'ما اسمك أيها المساعد؟'})});
const mb=await j(m);
if(mb?.conversation_id) created.convIds.push(mb.conversation_id);
const content=String(mb?.assistant_message?.content??'');
check('S10 assistant_name in reply.content', content.includes(NAME), `reply="${content.slice(0,110)}"`);
console.log(results.join('\n'));
for(const cid2 of created.convIds){await admin.from('messages').delete().eq('conversation_id',cid2).eq('clinic_id',CID);await admin.from('conversations').delete().eq('id',cid2).eq('clinic_id',CID);}
await admin.from('clinic_ai_settings').delete().eq('clinic_id',CID);
await admin.from('clinic_users').delete().eq('clinic_id',CID);
await admin.from('clinics').delete().eq('id',CID);
if(CID){const {data:users}=await admin.auth.admin.listUsers({perPage:200});const o=users.users.find(u=>u.email===email);if(o) await admin.auth.admin.deleteUser(o.id);}
console.log('CLEANUP2 clinic='+((await admin.from('clinics').select('id',{count:'exact',head:true}).eq('id',CID)).count??0));
process.exit(0);
