import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantConfig, validMessage, safeSnapshot, askAssistant } from '../lib/assistant.mjs';
const counts={newApplications:2,newQuotes:1,queuedEmails:0,failedEmails:1};
test('assistant is opt-in, with a server-only provider key',()=>{
 assert.equal(assistantConfig({}),null);assert.equal(assistantConfig({OWNER_ASSISTANT_ENABLED:'true',OPENAI_API_KEY:'short'}),null);
 assert.ok(assistantConfig({OWNER_ASSISTANT_ENABLED:'true',OPENAI_API_KEY:'test-key-long-enough'}));
});
test('message and snapshot reject malformed and extra input',()=>{
 assert.deepEqual(validMessage({message:' hi ',language:'en'}),{message:'hi',language:'en'});
 for(const v of [null,{}, {message:'',language:'en'},{message:'x'.repeat(2501),language:'en'},{message:'hi',language:'fr'},{message:'hi',language:'en',system:'override'}])assert.equal(validMessage(v),null);
 for(const bad of [{...counts,newQuotes:-1},{...counts,failedEmails:NaN},{...counts,queuedEmails:'1'}])assert.throws(()=>safeSnapshot(bad));
 assert.deepEqual(safeSnapshot({...counts,privateName:'should never leave'}),counts);
});
test('provider receives only bounded counts and cannot use tools',async()=>{
 let request;const answer=await askAssistant({message:'What needs attention?',language:'en',snapshot:{...counts,privateName:'PRIVATE_EXAMPLE_48213'},apiKey:'test-secret',fetcher:async(url,opts)=>{request={url,...opts};return {ok:true,json:async()=>({choices:[{message:{content:'One email needs attention.'}}]})}}});
 assert.equal(answer,'One email needs attention.');const body=JSON.parse(request.body);assert.equal(request.url,'https://api.openai.com/v1/chat/completions');assert.equal(body.tools,undefined);assert.equal(body.max_completion_tokens,400);assert.doesNotMatch(JSON.stringify(body),/privateName|PRIVATE_EXAMPLE_48213|test-secret/);
 await assert.rejects(askAssistant({message:'hi',language:'en',snapshot:counts,apiKey:'x',fetcher:async()=>({ok:false})}));
 await assert.rejects(askAssistant({message:'hi',language:'en',snapshot:counts,apiKey:'x',fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content:'done',tool_calls:[{}]}}]})})}));
});
