import { validMessage } from '../assistant.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function readBody(request){
 const reader=request.body?.getReader();if(!reader)throw new Error('Invalid body');let size=0,chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new Error('Body too large')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function snapshot(client){
 const results=await Promise.all([
  client.from('applicants').select('id',{count:'exact',head:true}).eq('status','new'),
  client.from('leads').select('id',{count:'exact',head:true}).eq('status','new'),
  client.from('application_notifications').select('id',{count:'exact',head:true}).in('status',['pending','processing']),
  client.from('application_notifications').select('id',{count:'exact',head:true}).eq('status','failed'),
 ]);
 if(results.some(r=>r.error||!Number.isSafeInteger(r.count)))throw new Error('Snapshot unavailable');
 return {newApplications:results[0].count,newQuotes:results[1].count,queuedEmails:results[2].count,failedEmails:results[3].count};
}
// A route selects connectionTest in server code; it cannot be selected by a request field.
export function createOwnerAssistantHandler({enabled,getOrigin,createSession,getConfig,ask,connectionTest=false}){
 return async request=>{
  if(!enabled())return reply({error:'Assistant is not configured.'},503);
  if(request.headers.get('origin')!==getOrigin()||request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return reply({error:'Request rejected.'},403);
  if(Number(request.headers.get('content-length')||0)>8192)return reply({error:'Request too large.'},413);
  let raw;try{raw=await readBody(request)}catch{return reply({error:'Invalid request.'},400)}
  let input;if(connectionTest){if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.keys(raw).length)return reply({error:'Invalid request.'},400);input={message:'Reply with the word ready.',language:'en'}}
  else {input=validMessage(raw);if(!input)return reply({error:'Invalid message.'},400)}
  try {
   const client=await createSession();if(!client)return reply({error:'Unavailable.'},503);
   const {data:{user},error:userError}=await client.auth.getUser();if(userError||!user)return reply({error:'Sign in required.'},401);
   const {data:member,error:memberError}=await client.from('owner_memberships').select('user_id').eq('user_id',user.id).maybeSingle();
   if(memberError||!member)return reply({error:'Not authorized.'},403);
   const {data:settings,error:settingsError}=await client.from('assistant_settings').select('provider,persona,include_counts').maybeSingle();
   if(settingsError||!settings||!['anthropic','open'].includes(settings.provider)||!['enthusiastic','calm'].includes(settings.persona)||typeof settings.include_counts!=='boolean')return reply({error:'Settings unavailable.'},503);
   const config=getConfig(settings.provider);if(!config)return reply(connectionTest?{error:'missing_config'}:{error:'Assistant is not configured.'},503);
   const {data:run,error:runError}=await client.rpc('begin_assistant_run');
   if(runError||!run?.[0])return reply({error:'Assistant access unavailable.'},503);
   if(run[0].result!=='ok')return reply({error:'Assistant request limit reached.'},429);
   const runId=run[0].run_id;if(!runId)return reply({error:'Assistant access unavailable.'},503);
   let success=false;
   try{
    const counts=!connectionTest&&settings.include_counts?await snapshot(client):null;
    const answer=await ask({...input,snapshot:counts,config,persona:settings.persona,maxTokens:connectionTest?100:400});success=true;
    return reply(connectionTest?{ok:true}:{answer});
   }catch(error){
    const category=['provider_auth','provider_unavailable','invalid_response'].includes(error?.category)?error.category:'provider_unavailable';
    return reply(connectionTest?{error:category}:{error:'Assistant unavailable. Please try again.'},503);
   }finally{try{await client.rpc('finish_assistant_run',{p_run_id:runId,p_success:success})}catch{/* Metadata remains started and counts toward quota. */}}
  }catch{return reply({error:'Assistant unavailable. Please try again.'},503)}
 };
}
