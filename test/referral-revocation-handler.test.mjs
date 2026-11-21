import test from 'node:test';
import assert from 'node:assert/strict';
import { revokeReferral } from '../lib/server/referral-revocation-handler.mjs';

const ID='11111111-1111-4111-8111-111111111111';
const form=id=>({get:key=>key==='id'?id:null});
function fixture(overrides={}) {
 const calls=[];
 const deps={enabled:()=>true,sessionClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:null};}}),onRevoked:()=>calls.push('revalidated'),...overrides};
 return {deps,calls};
}
test('revocation uses the session-bound RPC and returns no invitation or applicant information',async()=>{
 const {deps,calls}=fixture();
 assert.deepEqual(await revokeReferral(form(ID),deps),{revoked:true});
 assert.deepEqual(calls,[{name:'revoke_my_referral_invitation',args:{p_id:ID}},'revalidated']);
});
test('disabled, malformed, unauthorized and network failures fail closed with a fixed error',async()=>{
 const disabled=fixture({enabled:()=>false});
 assert.deepEqual(await revokeReferral(form(ID),disabled.deps),{error:true});
 assert.deepEqual(disabled.calls,[]);
 for(const id of ['',null,{},'not-a-uuid','11111111-1111-1111-1111-111111111111']) {
  const x=fixture(); assert.deepEqual(await revokeReferral(form(id),x.deps),{error:true}); assert.deepEqual(x.calls,[]);
 }
 for(const result of [{data:false,error:null},{data:null,error:{message:'sensitive database error'}}, {data:'true',error:null}]) {
  const x=fixture({sessionClient:async()=>({rpc:async()=>result})});
  assert.deepEqual(await revokeReferral(form(ID),x.deps),{error:true}); assert.deepEqual(x.calls,[]);
 }
 for(const sessionClient of [async()=>null,async()=>{throw Error('secret network error')},async()=>({rpc:async()=>{throw Error('secret provider error')}})]) {
  const x=fixture({sessionClient});assert.deepEqual(await revokeReferral(form(ID),x.deps),{error:true});
 }
 assert.deepEqual(await revokeReferral(null,fixture().deps),{error:true});
});
test('a failed cache refresh does not falsely report that committed revocation failed',async()=>{
 const x=fixture({onRevoked:()=>{throw Error('cache unavailable')}});
 assert.deepEqual(await revokeReferral(form(ID),x.deps),{revoked:true});
});
