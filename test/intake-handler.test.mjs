import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createIntakeHandler } from '../lib/server/intake-handler.mjs';

const origin='https://example.test';
const config={origin,hostname:'example.test',secret:'server-secret'};
const app={kind:'application',formLanguage:'en',requestId:'11111111-1111-4111-8111-111111111111',token:'valid-token',data:{firstName:'Test',phone:'3375550199',area:'Example',shifts:['nights'],transportation:'yes',languages:['en'],referrer:'',smsConsent:false}};
const quote={kind:'quote',formLanguage:'en',requestId:'22222222-2222-4222-8222-222222222222',token:'valid-token',data:{buildingType:'office',size:'unsure',frequency:'weekly',name:'Test',phone:'3375550199',email:'test@example.com'}};
function request(body,{requestOrigin=origin,type='application/json',headers={}}={}){return new Request(`${origin}/api/intake`,{method:'POST',headers:{origin:requestOrigin,'content-type':type,...headers},body:typeof body==='string'?body:JSON.stringify(body)});}
function harness({configured=true,allowReferral=true,verifyStatus=200,verifyResult,insertError=null,existingHash=null,lookupError=null,rpcResult='inserted',rpcError=null,throws=false}={}) {
  const calls={verify:[],insert:[],lookup:[],rpc:[],after:[],notification:0};
  const admin={from(table){return {insert:async(row)=>{calls.insert.push({table,row});return {error:insertError}},select(cols){return {eq(field,id){return {maybeSingle:async()=>{calls.lookup.push({table,cols,field,id});return {data:existingHash?{request_hash:existingHash}:null,error:lookupError}}}}}}}},rpc:async(name,args)=>{calls.rpc.push({name,args});return {data:rpcResult,error:rpcError}}};
  const handler=createIntakeHandler({getConfig:()=>configured?config:null,referralsEnabled:()=>allowReferral,createAdmin:()=>admin,after:(fn)=>calls.after.push(fn),processNotifications:async()=>{calls.notification++},fetcher:async(url,options)=>{calls.verify.push({url,options});if(throws)throw Error('private secret must not appear');return new Response(JSON.stringify(verifyResult??{success:true,hostname:'example.test',action:'application'}),{status:verifyStatus,headers:{'content-type':'application/json'}})}});
  return {handler,calls};
}
async function check(response,status){assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}

test('rejects disabled, cross-origin, malformed types, invalid and oversized bodies before verification',async()=>{
 let h=harness({configured:false}); await check(await h.handler(request(app)),503);assert.equal(h.calls.verify.length,0);
 h=harness(); await check(await h.handler(request(app,{requestOrigin:'https://attacker.test'})),403);await check(await h.handler(request(app,{type:'application/jsonbogus'})),403);await check(await h.handler(request('{bad')),400);await check(await h.handler(request({...app,unexpected:true})),400);
 await check(await h.handler(request('x'.repeat(16385))),413);await check(await h.handler(request('x'.repeat(16385),{headers:{'content-length':'1'}})),413);await check(await h.handler(request(app,{headers:{'content-length':'99999'}})),413);
 const invalidUtf8=new Request(`${origin}/api/intake`,{method:'POST',headers:{origin,'content-type':'application/json'},body:new Uint8Array([0xff])});await check(await h.handler(invalidUtf8),400);assert.equal(h.calls.verify.length,0);
});

test('Turnstile must succeed with the configured hostname and matching action',async()=>{
 for(const verifyResult of [{success:false,hostname:'example.test',action:'application'},{success:true,hostname:'wrong.test',action:'application'},{success:true,hostname:'example.test',action:'quote'}]){const h=harness({verifyResult});await check(await h.handler(request(app)),400);assert.equal(h.calls.insert.length,0)}
 const unavailable=harness({verifyStatus:503});await check(await unavailable.handler(request(app)),503);
 const network=harness({throws:true});const body=await check(await network.handler(request(app)),503);assert.doesNotMatch(JSON.stringify(body),/private secret/);
});

test('verified application saves validated data and schedules one best-effort outbox run',async()=>{
 const h=harness();const response=await h.handler(request(app,{type:'application/json; charset=utf-8'}));assert.deepEqual(await check(response,200),{ok:true});assert.equal(h.calls.insert[0].table,'applicants');assert.equal(h.calls.insert[0].row.phone,'3375550199');assert.equal(h.calls.insert[0].row.sms_consent,false);assert.equal(h.calls.insert[0].row.consented_at,null);assert.equal(h.calls.after.length,1);await h.calls.after[0]();assert.equal(h.calls.notification,1);
 const verify=JSON.parse(h.calls.verify[0].options.body);assert.equal(verify.secret,'server-secret');assert.equal(verify.response,'valid-token');
});

test('quote uses a separate table and never schedules an applicant notification',async()=>{
 const h=harness({verifyResult:{success:true,hostname:'example.test',action:'quote'}});await check(await h.handler(request(quote)),200);assert.equal(h.calls.insert[0].table,'leads');assert.equal(h.calls.after.length,0);
});

test('duplicate normal submissions reconcile only matching content; failures do not expose database errors',async()=>{
 const first=harness();await first.handler(request(app));const hash=first.calls.insert[0].row.request_hash;
 for(const [existingHash,status] of [[hash,200],['a'.repeat(64),409],[null,409]]) {const h=harness({insertError:{code:'23505'},existingHash});await check(await h.handler(request(app)),status);assert.equal(h.calls.lookup.length,1)}
 const h=harness({insertError:{code:'unknown',message:'private database details'}});const body=await check(await h.handler(request(app)),503);assert.doesNotMatch(JSON.stringify(body),/private database details/);
});

test('referral code is hashed; invalid, conflicting and failed claims fail closed',async()=>{
 const referred={...app,data:{...app.data,referralCode:'a'.repeat(64)}};
 const off=harness({allowReferral:false});await check(await off.handler(request(referred)),503);assert.equal(off.calls.verify.length,0);
 for(const [rpcResult,status] of [['inserted',200],['duplicate',200],['invalid',422],['conflict',409],['unexpected',503]]){const h=harness({rpcResult});await check(await h.handler(request(referred)),status);assert.equal(h.calls.insert.length,0);assert.equal(h.calls.rpc[0].args.p_code_hash,createHash('sha256').update('a'.repeat(64)).digest('hex'));assert.equal('referralCode' in h.calls.rpc[0].args.p_row,false);assert.equal(h.calls.after.length,status===200?1:0)}
 const fail=harness({rpcError:{message:'private'}});await check(await fail.handler(request(referred)),503);
});
