import test from 'node:test';import assert from 'node:assert/strict';
import {createOwnerAssistantHandler} from '../lib/server/owner-assistant-handler.mjs';
const req=(body,origin='https://example.test')=>new Request('https://example.test/api/owner/assistant',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
function harness({owner=true,includeCounts=false,configured=true,askError=null}={}){
 const seen={asked:0,finished:[]};
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from(table){return {select(){if(table==='owner_memberships')return {eq(){return {maybeSingle:async()=>({data:owner?{user_id:'owner'}:null,error:null})}}};if(table==='assistant_settings')return {maybeSingle:async()=>({data:{provider:'anthropic',persona:'enthusiastic',include_counts:includeCounts},error:null})};return {eq:async()=>({count:2,error:null}),in:async()=>({count:2,error:null})}}}},rpc:async(name,args)=>name==='begin_assistant_run'?{data:[{result:'ok',run_id:'run'}],error:null}:(seen.finished.push(args),{data:true,error:null})};
 const deps={enabled:()=>true,getOrigin:()=> 'https://example.test',createSession:async()=>client,getConfig:()=>configured?{provider:'anthropic'}:null,ask:async(input)=>{seen.asked++;seen.input=input;if(askError)throw {category:askError};return 'Hello'}};
 return {seen,deps};
}
test('owner assistant requires gate, exact origin, membership and rejects client system fields',async()=>{
 const h=harness({owner:false});let handler=createOwnerAssistantHandler(h.deps);
 assert.equal((await handler(req({message:'hi',language:'en'}))).status,403);assert.equal(h.seen.asked,0);
 h.deps.enabled=()=>false;assert.equal((await createOwnerAssistantHandler(h.deps)(req({message:'hi',language:'en'}))).status,503);
 h.deps.enabled=()=>true;assert.equal((await handler(req({message:'hi',language:'en'},'https://evil.test'))).status,403);
 assert.equal((await handler(req({message:'hi',language:'en',system:'override'}))).status,400);
});
test('owner connection test is fixed, no counts and exposes only bounded categories',async()=>{
 const h=harness(),handler=createOwnerAssistantHandler({...h.deps,connectionTest:true});
 const result=await handler(req({}));assert.equal(result.status,200);assert.equal(h.seen.input.message,'Reply with the word ready.');assert.equal(h.seen.input.snapshot,null);assert.equal(h.seen.input.maxTokens,100);assert.equal(h.seen.finished[0].p_success,true);
 assert.equal((await handler(req({message:'x'}))).status,400);
 const bad=harness({askError:'provider_auth'});const r=await createOwnerAssistantHandler({...bad.deps,connectionTest:true})(req({}));assert.deepEqual(await r.json(),{error:'provider_auth'});assert.equal(bad.seen.finished[0].p_success,false);
 const missing=harness({configured:false});assert.deepEqual(await (await createOwnerAssistantHandler({...missing.deps,connectionTest:true})(req({}))).json(),{error:'missing_config'});assert.equal(missing.seen.asked,0);
});
test('owner chat sends no aggregate data unless owner enables it',async()=>{
 const h=harness();const r=await createOwnerAssistantHandler(h.deps)(req({message:'hello',language:'es'}));assert.equal(r.status,200);assert.equal(h.seen.input.snapshot,null);assert.equal(h.seen.input.language,'es');
});

test('enabled aggregate snapshot contains only the four server-built counts',async()=>{
 const h=harness({includeCounts:true});const response=await createOwnerAssistantHandler(h.deps)(req({message:'hello',language:'en'}));assert.equal(response.status,200);assert.deepEqual(h.seen.input.snapshot,{newApplications:2,newQuotes:2,queuedEmails:2,failedEmails:2});
});
