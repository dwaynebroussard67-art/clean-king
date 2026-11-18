import { NextResponse } from 'next/server';
import { assistantConfig, askAssistant, validMessage } from '../../../../lib/assistant.mjs';
import { ownerLoginEnabled, sessionClient } from '../../../../lib/server/supabase';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const reply = (body,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function readBody(request) {
  const reader=request.body?.getReader(); if(!reader) throw new Error('No body');
  let length=0,chunks=[];
  for (;;) {const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>8192){await reader.cancel();throw new Error('Too large')}chunks.push(value)}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder().decode(bytes));
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
export async function POST(request){
  const config=assistantConfig(process.env);
  if(!config || !ownerLoginEnabled())return reply({error:'Assistant is not configured.'},503);
  if(request.headers.get('origin')!==process.env.APP_ORIGIN || request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return reply({error:'Request rejected.'},403);
  if(Number(request.headers.get('content-length')||0)>8192)return reply({error:'Request too large.'},413);
  let input;try{input=validMessage(await readBody(request))}catch{return reply({error:'Invalid request.'},400)}
  if(!input)return reply({error:'Invalid message.'},400);
  const client=await sessionClient();if(!client)return reply({error:'Unavailable.'},503);
  const {data:{user},error:userError}=await client.auth.getUser();
  if(userError||!user)return reply({error:'Sign in required.'},401);
  const {data:member,error:memberError}=await client.from('owner_memberships').select('user_id').eq('user_id',user.id).maybeSingle();
  if(memberError||!member)return reply({error:'Not authorized.'},403);
  let runId=null, success=false;
  try{
    const {data,error}=await client.rpc('begin_assistant_run');
    if(error||!data?.[0])return reply({error:'Assistant access unavailable.'},503);
    if(data[0].result!=='ok')return reply({error:'Assistant request limit reached.'},429);
    runId=data[0].run_id;
    if(!runId)return reply({error:'Assistant access unavailable.'},503);
    const counts=await snapshot(client);
    const answer=await askAssistant({...input,snapshot:counts,apiKey:config.apiKey});
    success=true;
    return reply({answer});
  }catch{return reply({error:'Assistant unavailable. Please try again.'},503)}
  finally {if(runId){try{await client.rpc('finish_assistant_run',{p_run_id:runId,p_success:success})}catch{/* Metadata may remain started; quota still counts. */}}}
}
