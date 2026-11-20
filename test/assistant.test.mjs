import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantConfig,allowedOpenEndpoint,validMessage,safeSnapshot,askAssistant} from '../lib/assistant.mjs';
const counts={newApplications:2,newQuotes:1,queuedEmails:0,failedEmails:1};
const env={OWNER_ASSISTANT_ENABLED:'true',ANTHROPIC_API_KEY:'example-secret-key',ANTHROPIC_MODEL:'example-model',ASSISTANT_OPEN_BASE_URL:'https://provider.example/v1',ASSISTANT_OPEN_ALLOWED_HOSTS:'provider.example',ASSISTANT_OPEN_API_KEY:'example-secret-key',ASSISTANT_OPEN_MODEL:'example-model'};
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
test('provider selection is explicit, opt-in and Anthropic defaults without fallback',()=>{
 assert.equal(assistantConfig({}),null);assert.equal(assistantConfig({...env,ANTHROPIC_MODEL:''}),null);
 assert.equal(assistantConfig(env).provider,'anthropic');assert.equal(assistantConfig(env,'open').provider,'open');assert.equal(assistantConfig(env,'invalid'),null);
});
test('open endpoint requires an exact deployment allowlist, HTTPS, no IP or credentials',()=>{
 assert.equal(allowedOpenEndpoint('https://provider.example/v1','provider.example'),'https://provider.example/v1/chat/completions');
 for(const base of ['http://provider.example/v1','https://127.0.0.1/v1','https://[::1]/v1','https://localhost/v1','https://user:pass@provider.example/v1','https://provider.example:8443/v1','https://provider.example/v1?x=y','https://evilprovider.example/v1'])assert.equal(allowedOpenEndpoint(base,'provider.example'),null);
 assert.equal(allowedOpenEndpoint('https://provider.example/v1',''),null);
});
test('message and snapshot reject malformed and extra input',()=>{
 assert.deepEqual(validMessage({message:' hi ',language:'en'}),{message:'hi',language:'en'});
 for(const v of [null,{}, {message:'',language:'en'},{message:'x'.repeat(2501),language:'en'},{message:'hi',language:'fr'},{message:'hi',language:'en',system:'override'}])assert.equal(validMessage(v),null);
 for(const bad of [{...counts,newQuotes:-1},{...counts,failedEmails:NaN},{...counts,queuedEmails:'1'}])assert.throws(()=>safeSnapshot(bad));
 assert.deepEqual(safeSnapshot({...counts,privateName:'never leave'}),counts);
});
test('Anthropic receives fixed boundaries and counts only, no tools or fallback',async()=>{
 let request;const answer=await askAssistant({message:'What needs attention?',language:'en',snapshot:{...counts,privateName:'PRIVATE_EXAMPLE'},config:assistantConfig(env),fetcher:async(url,opts)=>{request={url,...opts};return json({stop_reason:'end_turn',content:[{type:'text',text:'One email needs attention.'}]})}});
 assert.equal(answer,'One email needs attention.');const body=JSON.parse(request.body);assert.equal(request.url,'https://api.anthropic.com/v1/messages');assert.equal(request.redirect,'error');assert.equal(body.tools,undefined);assert.equal(body.max_tokens,400);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_EXAMPLE|example-secret-key/);assert.match(body.system,/Never claim you performed an action/);
});
test('open compatible adapter fails closed on tool calls, truncation, auth and oversized output',async()=>{
 const args={message:'hi',language:'en',snapshot:null,config:assistantConfig(env,'open')};let n=0;
 assert.equal(await askAssistant({...args,fetcher:async()=>{n++;return json({choices:[{finish_reason:'stop',message:{content:'Hello!'}}]})}}),'Hello!');assert.equal(n,1);
 await assert.rejects(askAssistant({...args,fetcher:async()=>json({choices:[{finish_reason:'tool_calls',message:{content:'x',tool_calls:[{}]}}]})}),e=>e.category==='invalid_response');
 await assert.rejects(askAssistant({...args,fetcher:async()=>json({choices:[{finish_reason:'length',message:{content:'x'}}]})}),e=>e.category==='invalid_response');
 await assert.rejects(askAssistant({...args,fetcher:async()=>new Response('',{status:401})}),e=>e.category==='provider_auth');
 await assert.rejects(askAssistant({...args,fetcher:async()=>new Response('x'.repeat(262145))}),e=>e.category==='invalid_response');
 await assert.rejects(askAssistant({...args,fetcher:async()=>json({choices:[{finish_reason:'stop',message:{content:'example-secret-key'}}]})}),e=>e.category==='invalid_response');
});
