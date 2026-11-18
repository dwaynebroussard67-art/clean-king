import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationEmail, deliverApplicationEmail, notificationConfig } from '../lib/notifications.mjs';
const env = { APPLICATION_EMAIL_NOTIFICATIONS_ENABLED:'true', APPLICATION_NOTIFICATION_TO:'owner@example.com', APPLICATION_NOTIFICATION_FROM:'hiring@example.com', APP_ORIGIN:'https://example.com', RESEND_API_KEY:'re_fake_key_for_test' };
const job = {notification_id:'11111111-1111-4111-8111-111111111111',first_name:'Mia\nUrgent: fake',phone:'3375550199',area:'Lafayette',shifts:['nights','weekends'],transportation:true,languages:['en','es'],referrer:'Alex'};
test('notifications require explicit opt in, sender, recipient, HTTPS origin and API key',()=>{
 assert.equal(notificationConfig({}),null);
 for(const changes of [{APPLICATION_EMAIL_NOTIFICATIONS_ENABLED:'false'},{APPLICATION_NOTIFICATION_TO:''},{APPLICATION_NOTIFICATION_TO:'bad\nBcc: x@example.com'},{APPLICATION_NOTIFICATION_FROM:'bad'},{APP_ORIGIN:'http://example.com'},{APP_ORIGIN:'https://example.com/path'},{RESEND_API_KEY:''}]) assert.equal(notificationConfig({...env,...changes}),null);
 assert.equal(notificationConfig(env).to,'owner@example.com');
});
test('email contains useful hiring details without allowing line spoofing',()=>{
 const message=applicationEmail(job,notificationConfig(env));
 assert.match(message.text,/First name: Mia Urgent: fake/);assert.match(message.text,/3375550199/);assert.match(message.text,/Nights, Weekends/);assert.match(message.text,/https:\/\/example.com\/owner/);
 assert.doesNotMatch(message.text,/\nUrgent:/); assert.equal(message.subject,'New applicant ready to review');
});
test('provider call uses a stable idempotency key and no applicant-supplied headers',async()=>{
 let request;const ok=await deliverApplicationEmail(job,notificationConfig(env),async(url,opts)=>{request={url,...opts};return {ok:true}});
 assert.equal(ok,true); assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.headers['Idempotency-Key'],`application/${job.notification_id}`);assert.equal(JSON.parse(request.body).to[0],env.APPLICATION_NOTIFICATION_TO);
 assert.equal(await deliverApplicationEmail(job,notificationConfig(env),async()=>({ok:false})),false);
 await assert.rejects(deliverApplicationEmail(job,notificationConfig(env),async()=>{throw new Error('network')}));
});

test('worker records failure, stops on lost lease and caps batches',async()=>{
 const {processQueue}=await import('../lib/notifications.mjs');
 let calls=[], count=0;
 let result=await processQueue({limit:99,claim:async()=>({id:++count}),deliver:async()=>{throw new Error('offline')},finish:async(job,ok)=>{calls.push([job.id,ok]);return true}});
 assert.deepEqual(result,{processed:5,errors:5});assert.deepEqual(calls[0],[1,false]);
 result=await processQueue({limit:5,claim:async()=>({id:1}),deliver:async()=>true,finish:async()=>false});assert.deepEqual(result,{processed:1,errors:1});
 result=await processQueue({claim:async()=>{throw new Error('db')},deliver:async()=>true,finish:async()=>true});assert.deepEqual(result,{processed:0,errors:1});
 result=await processQueue({claim:async()=>null,deliver:async()=>true,finish:async()=>true});assert.deepEqual(result,{processed:0,errors:0});
});

test('scheduler reports unhealthy until persistent failures and stale backlog are resolved',async()=>{
 const {notificationWorkerStatus}=await import('../lib/notifications.mjs');
 const ok={configured:true,errors:0},healthy={configured:true,failed:0,overdue:0};
 assert.equal(notificationWorkerStatus(ok,healthy),200);
 for(const health of [{...healthy,failed:1},{...healthy,overdue:1},{configured:false},null]) assert.equal(notificationWorkerStatus(ok,health),503);
 assert.equal(notificationWorkerStatus({...ok,errors:1},healthy),503);
 assert.equal(notificationWorkerStatus({configured:false,errors:0},healthy),503);
});
