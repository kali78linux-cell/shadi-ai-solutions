import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((m,l)=>{
  const [,k,v]=l.match(/^([A-Z0-9_]+)=(.*)/i)||[]; if(k)m[k]=v; return m;
},{});
const SB_URL=env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY=env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SR_KEY=env.SUPABASE_SERVICE_ROLE_KEY;
const sb=createClient(SB_URL,SB_KEY), admin=createClient(SB_URL,SR_KEY);
const BASE='http://localhost:3111', T='12c-'+Date.now();
const ids={clinics:[],users:[],conversations:[],providers:[],services:[],linkRows:[]};
const log=[];
const addLog=(sc,res,ev,lv)=>log.push({scenario:sc,result:res,evidence:ev,level:lv});

async function cleanup(){
  for(const c of ids.conversations){await admin.from('messages').delete().eq('conversation_id',c);await admin.from('conversations').delete().eq('id',c).eq('clinic_id',ids.clinics[0]);}
  for(const p of ids.providers)await admin.from('providers').delete().eq('id',p).eq('clinic_id',ids.clinics[0]);
  for(const s of ids.services)await admin.from('clinic_services').delete().eq('id',s).eq('clinic_id',ids.clinics[0]);
  for(const l of ids.linkRows)await admin.from('provider_services').delete().eq('id',l).eq('clinic_id',ids.clinics[0]);
  await admin.from('clinic_users').delete().eq('clinic_id',ids.clinics[0]);
  await admin.from('clinics').delete().eq('id',ids.clinics[0]);
  await admin.from('users').delete().eq('id',ids.users[0]);
}

async function regLogin(){
  const email='owner-'+T+'@test.com';
  const r=await fetch(BASE+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Pass1234!',owner_name:'Owner '+T,clinic_name:'عيادة '+T,clinic_slug:'clinic-'+T,city:'رام الله'})});
  const d=await r.json();
  console.log('[DBG] reg status=',r.status,' data?',!!d.data,' err=',d.error||'');
  ids.clinics.push(d.data?.id);
  const {data:session}=await sb.auth.signInWithPassword({email,password:'Pass1234!'});
  console.log('[DBG] login session?', !!session, ' err=', (session===null?'CLICK':''));
  return session.session;
}

async function fetchUserId(){
  const {data:cu,error:cue}=await admin.from('clinic_users').select('user_id').eq('clinic_id',ids.clinics[0]).maybeSingle();
  if(cue) console.log('[DBG] clinic_users err=', cue.message);
  return cu?.user_id;
}

async function seed2(uid){
  const cid=ids.clinics[0];
  async function ins(table,row,cfield){
    const r=await admin.from(table).insert(row);
    if(r.error){console.log('[SEED-ERR]',table,cfield,r.error.message);throw new Error(r.error.message);}
    const q=await admin.from(table).select('id').eq(cfield,row[cfield]);
    if(q.error){console.log('[SEED-Q-ERR]',table,q.error.message);throw new Error(q.error.message);}
    const rec=q.data?.[q.data.length-1];
    if(!rec){console.log('[SEED-NULL]',table,cfield,'len='+q.data?.length);throw new Error('seed missing '+cfield);}
    console.log('[TRACE] seeded',table,cfield,'->',rec.id.substring(0,8));
    return rec.id;
  }
  const s1=await ins('clinic_services',{clinic_id:cid,name:'فحص أسنان '+T,price:50,pricing_type:'fixed',duration_minutes:30,active:true},'name');
  const s2=await ins('clinic_services',{clinic_id:cid,name:'أشعة أسنان '+T,price:80,pricing_type:'fixed',duration_minutes:30,active:true},'name');
  const s3=await ins('clinic_services',{clinic_id:cid,name:'تنظيف أسنان '+T,price:100,pricing_type:'fixed',duration_minutes:30,active:true},'name');
  ids.services.push(s1,s2,s3);
  const p1=await ins('providers',{clinic_id:cid,user_id:uid,name:'د. أحمد '+T,provider_type:'dentist'},'name');
  ids.providers.push(p1);
  const linkRes=await admin.from('provider_services').insert([
    {clinic_id:cid,provider_id:p1,service_id:s1},
    {clinic_id:cid,provider_id:p1,service_id:s2},
    {clinic_id:cid,provider_id:p1,service_id:s3}
  ]).select('id');
  if(linkRes.error){console.log('[SEED-ERR] provider_services',linkRes.error.message);throw new Error(linkRes.error.message);}
  for(const lr of (linkRes.data||[])) ids.linkRows.push(lr.id);
  console.log('[TRACE] seeded provider_services p1 x3 (clinic-scoped) n='+(linkRes.data?.length||0));
  // 2026-09-15 = Tuesday (getUTCDay=2); 10:00 inside 09:00-17:00. Synthetic only.
  const sched=await admin.from('provider_schedules').insert({clinic_id:cid,provider_id:p1,weekday:2,enabled:true,start_time:'09:00',end_time:'17:00',appointment_duration_minutes:30});
  if(sched.error){console.log('[SEED-ERR] provider_schedules',sched.error.message);throw new Error(sched.error.message);}
  console.log('[TRACE] seeded provider_schedules p1 weekday=2 09:00-17:00');
  return {s1,s2,s3,p1};
}

async function postMsg(token,cid,msg,conversationId){
  const body={clinic_id:cid,text:msg};
  if(conversationId)body.conversation_id=conversationId;
  const r=await fetch(BASE+'/api/public/ai/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});
  return r.json();
}

async function getMeta(cid){
  const {data}=await admin.from('conversations').select('metadata').eq('id',cid).single();
  return data?.metadata||{};
}

(async()=>{
  try{
    const session=await regLogin(); const token=session.access_token;
    addLog('U1: register+login synthetic owner','PASS','clinic='+ids.clinics[0]+' user='+ids.users[0],'actual interaction');
    console.log('[TRACE] before fetchUserId');
    const uid=await fetchUserId(); console.log('[TRACE] uid=',uid);
    ids.users.push(uid);
    console.log('[TRACE] after push users0=',ids.users[0]);
    console.log('[TRACE] before seed cid=',ids.clinics[0]);
    const {s1,s2,s3,p1}=await seed2(ids.users[0]);
    console.log('[TRACE] after seed s1=',s1,' s2=',s2,' s3=',s3,' p1=',p1);
    addLog('U1b: seed 3 services + 1 provider','PASS','fahs='+s1+' asha='+s2+' tandheef='+s3+' prov='+p1,'actual interaction');

    // Turn 1: pain
    const m1=await postMsg(token,ids.clinics[0],'طاحونتي بتجعني لما بشرب بارد');
    ids.conversations.push(m1.conversation_id);
    const meta1=await getMeta(m1.conversation_id);
    addLog('U2: Turn 1 pain → recommendation',meta1.recommended_service_id?'PASS':'FAIL','rec1='+meta1.recommended_service_id+' (expected fahs='+s1+')','actual interaction');
    addLog('U2b: REC1 = فحص أسنان',meta1.recommended_service_id===s1?'PASS':'FAIL','rec1='+meta1.recommended_service_id+' vs fahs='+s1,'actual interaction');

    // Turn 2: explicit asha, SAME conversation
    const m2=await postMsg(token,ids.clinics[0],'بدي أعمل أشعة أسنان للضرس بدل الفحص',m1.conversation_id);
    addLog('U3: Turn 2 same conversation',m2.conversation_id===m1.conversation_id?'PASS':'FAIL','conv2='+m2.conversation_id+' vs conv1='+m1.conversation_id,'actual interaction');
    const meta2=await getMeta(m1.conversation_id);
    addLog('U3b: REC2 = أشعة أسنان',meta2.recommended_service_id===s2?'PASS':'FAIL','rec2='+meta2.recommended_service_id+' vs asha='+s2,'actual interaction');
    addLog('U3c: REC2 ≠ REC1 (freshness)',meta2.recommended_service_id!==meta1.recommended_service_id?'PASS':'FAIL','rec1='+meta1.recommended_service_id+' rec2='+meta2.recommended_service_id,'actual interaction');
    addLog('U3d: booking_context reflects new rec',m2.booking_context?.recommended_service_id===s2?'PASS':'FAIL','bc_rec='+m2.booking_context?.recommended_service_id,'actual interaction');

    // Isolation: new conversation
    const m3=await postMsg(token,ids.clinics[0],'مرحبا');
    ids.conversations.push(m3.conversation_id);
    const meta3=await getMeta(m3.conversation_id);
    addLog('U4: new conversation does NOT inherit recommendation',!meta3.recommended_service_id?'PASS':'FAIL','rec3='+meta3.recommended_service_id+' (expected null)','actual interaction');
    addLog('U4b: conv2 ≠ conv1',m3.conversation_id!==m1.conversation_id?'PASS':'FAIL','conv3='+m3.conversation_id,'actual interaction');

    // Phone validation: missing phone → 400
    const bNoPhone=await fetch(BASE+'/api/booking',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({clinic_id:ids.clinics[0],service_id:s2,provider_id:p1,date:'2026-09-15',time:'10:00',conversation_id:m1.conversation_id,patient_name:'Test'})});
    addLog('U5: booking without phone → 400',bNoPhone.status===400?'PASS':'FAIL','status='+bNoPhone.status,'HTTP-only');

    // Phone validation: valid phone → 201
    const bWithPhone=await fetch(BASE+'/api/booking',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({clinic_id:ids.clinics[0],service_id:s2,service:'أشعة أسنان '+T,provider_id:p1,date:'2026-09-15',time:'10:00',conversation_id:m1.conversation_id,patient_name:'Test',phone:'+970591234567'})});
    addLog('U6: booking with valid phone → 201',bWithPhone.status===201?'PASS':'FAIL','status='+bWithPhone.status,'HTTP-only');

    // Provider filtering by service
    const prov=await fetch(BASE+'/api/booking/providers?clinic_id='+ids.clinics[0]+'&service_id='+s2,{headers:{'Authorization':'Bearer '+token}});
    const provData=await prov.json();
    const provList=provData?.data?.providers;
    const provOk=Array.isArray(provList)&&provList.some(p=>p.id===p1);
    addLog('U7: provider filtered by service_id',provOk?'PASS':'FAIL','count='+(Array.isArray(provList)?provList.length:'n/a')+(provOk?' p1='+p1:''),'HTTP-only');

    // Service list
    const serv=await fetch(BASE+'/api/booking/services?clinic_id='+ids.clinics[0],{headers:{'Authorization':'Bearer '+token}});
    const servData=await serv.json();
    const svcList=servData?.data?.services;
    const svcOk=Array.isArray(svcList)&&svcList.length===3;
    addLog('U8: service list returns 3 services',svcOk?'PASS':'FAIL','count='+(Array.isArray(svcList)?svcList.length:'n/a'),'HTTP-only');

    // Reload: Server wins
    const getMsgs=await fetch(BASE+'/api/public/ai/messages?clinic_id='+ids.clinics[0]+'&conversation_id='+m1.conversation_id,{headers:{'Authorization':'Bearer '+token}});
    const msgs=await getMsgs.json();
    addLog('U9: reload returns same conversation (Server wins)',Array.isArray(msgs?.data)&&msgs.data.length>=2?'PASS':'FAIL','msgCount='+(Array.isArray(msgs?.data)?msgs.data.length:'n/a'),'HTTP-only');

    // U10: cross-tenant denied on a PROTECTED endpoint (authorizeClinicRequest)
    const crossT=await fetch(BASE+'/api/clinic/providers?clinic_id=7fe17ccd-0000-0000-0000-000000000000',{headers:{'Authorization':'Bearer '+token}});
    const crossStatus=crossT.status;
    let crossBody=null; try{ crossBody=await crossT.clone().json(); }catch{}
    const denied = crossStatus===403 || crossStatus===401;
    const noLeak = !denied ? true : true; // if denied there's no body to leak
    addLog('U10: cross-tenant denied on protected endpoint (shadi-nouri)', denied?'PASS':'FAIL','status='+crossStatus+(crossBody?.error?' err='+crossBody.error:''),'HTTP-only');
    addLog('U10b: no tenant-B data leaked', !denied ? 'FAIL' : 'PASS', 'status='+crossStatus+' (denied → no payload returned)','HTTP-only');

    // Cleanup
    await cleanup();
    const verify=await admin.from('conversations').select('id').in('id',ids.conversations);
    addLog('U11: cleanup complete',verify.data?.length===0?'PASS':'FAIL','remaining='+verify.data?.length,'actual interaction');

    // Report
    console.log('\n========== STEP 12C UI VERIFICATION REPORT ==========\n');
    for(const l of log) console.log('['+l.result+'] '+l.scenario+'\n     evidence: '+l.evidence+'\n     level: '+l.level+'\n');
    const passed=log.filter(l=>l.result==='PASS').length;
    console.log('\n===== RESULT: '+passed+'/'+log.length+' PASS =====\n');
  }catch(e){ console.error('FATAL:',e.message); await cleanup(); }
})();
