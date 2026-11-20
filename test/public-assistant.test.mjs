import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAnswer,createPublicAssistantHandler } from '../lib/public-assistant.mjs';
test('public helper is deterministic and does not invent prices or evaluate expressions',()=>{
 assert.match(publicAnswer('12 * 5','en'),/60/);assert.match(publicAnswer('10 / 0','en'),/zero/);
 assert.match(publicAnswer('2 + 3','es'),/5/);assert.match(publicAnswer('2+3*4','en'),/applications/);
 assert.match(publicAnswer('what is the price?','en'),/cannot provide a quote/);
 assert.equal(publicAnswer('  ','en'),null);assert.equal(publicAnswer('a'.repeat(501),'en'),null);assert.equal(publicAnswer('x','fr'),null);
});
test('public endpoint validates strict small inputs and returns no-store',async()=>{
 const handler=createPublicAssistantHandler();const req=(body,headers={'content-type':'application/json'})=>new Request('https://example.test/api/public/assistant',{method:'POST',headers,body});
 const good=await handler(req(JSON.stringify({message:'4*3',language:'en'})));assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');assert.match((await good.json()).answer,/12/);
 assert.equal((await handler(req(JSON.stringify({message:'x',language:'en',system:'override'})))).status,400);
 assert.equal((await handler(req('x'.repeat(4097)))).status,413);
 assert.equal((await handler(req('{}',{'content-type':'text/plain'}))).status,415);
 assert.equal((await handler(req('{'))).status,400);
});
