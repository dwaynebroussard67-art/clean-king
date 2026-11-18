import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationHandler} from '../lib/server/notification-handler.mjs';
const secret='s'.repeat(40);
const req=value=>new Request('https://example.test/api/jobs/application-notifications',{headers:value?{authorization:value}:{}});

test('scheduler requires a correctly sized bearer secret and never calls the queue for unauthorized requests',async()=>{
 let called=0;const h=createNotificationHandler({getSecret:()=>secret,processNotifications:async()=>{called++},checkHealth:async()=>{called++}});
 for(const token of [null,'Bearer wrong','Bearer '+ 'x'.repeat(40),'Basic '+secret]){const response=await h(req(token));assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store')}
 assert.equal(called,0);
 const weak=createNotificationHandler({getSecret:()=> 'short',processNotifications:async()=>{called++},checkHealth:async()=>{called++}});assert.equal((await weak(req('Bearer short'))).status,401);assert.equal(called,0);
});
test('scheduler reports an aggregate backlog and fails closed on errors',async()=>{
 let limit;const result={configured:true,processed:1,errors:0};
 for(const [health,status] of [[{configured:true,failed:0,overdue:0},200],[{configured:true,failed:1,overdue:0},503],[{configured:true,failed:0,overdue:2},503],[{configured:false},503]]){
  const h=createNotificationHandler({getSecret:()=>secret,processNotifications:async n=>{limit=n;return result},checkHealth:async()=>health});const response=await h(req('Bearer '+secret));assert.equal(response.status,status);assert.equal(limit,5);assert.deepEqual(await response.json(),{...result,health});
 }
 const h=createNotificationHandler({getSecret:()=>secret,processNotifications:async()=>{throw Error('provider private data')},checkHealth:async()=>null});const response=await h(req('Bearer '+secret));assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(await response.json()),/provider private data/);
});
