import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createIntakeHandler} from '../lib/server/intake-handler.mjs';

// Local integrated test, not live Supabase/Auth/Turnstile/email or a browser E2E.
test('synthetic referral submits through the HTTP handler into owner-approved onboarding',async()=>{
 const db=new PGlite();
 const owner='11111111-1111-4111-8111-111111111111',employee='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
 const requestId='44444444-4444-4444-8444-444444444444',code='a'.repeat(64),codeHash=createHash('sha256').update(code).digest('hex');
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  const root=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(root)).filter(x=>x.endsWith('.sql')).sort())await db.exec((await readFile(new URL(file,root),'utf8')).replace('create extension if not exists pgcrypto;',''));
  await db.exec(`insert into auth.users values ('${owner}'),('${employee}'),('${other}'); insert into public.owner_memberships(user_id) values ('${owner}'); insert into public.employee_memberships(user_id) values ('${employee}'); set role authenticated; select set_config('request.jwt.claim.sub','${employee}',false)`);
  assert.equal((await db.query('select active from public.employee_memberships where user_id=$1',[employee])).rows[0].active,true);
  await db.exec('reset role; set role service_role');
  assert.ok((await db.query('select public.create_employee_invitation($1,$2) as expires',[employee,codeHash])).rows[0].expires);
  const calls=[];
  const handler=createIntakeHandler({getConfig:()=>({origin:'https://example.test',hostname:'example.test',secret:'synthetic'}),referralsEnabled:()=>true,
   createAdmin:()=>({rpc:async(name,args)=>{assert.equal(name,'submit_referred_application');const result=await db.query('select public.submit_referred_application($1::jsonb,$2) as result',[JSON.stringify(args.p_row),args.p_code_hash]);return {data:result.rows[0].result,error:null}}}),
   after:fn=>calls.push(fn),processNotifications:async()=>{},fetcher:async()=>new Response(JSON.stringify({success:true,hostname:'example.test',action:'application'}),{headers:{'content-type':'application/json'}})});
  const payload={kind:'application',formLanguage:'en',requestId,token:'synthetic-token',data:{firstName:'Synthetic',phone:'3375550199',area:'Synthetic',shifts:['nights'],transportation:'yes',languages:['en'],referrer:'',smsConsent:false,referralCode:code,experienceLevel:'under_one',commercialExperience:'yes',residentialExperience:null,equipmentExperience:null,trainingWillingness:'yes'}};
  const submit=()=>handler(new Request('https://example.test/api/intake',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(payload)}));
  assert.equal((await submit()).status,200);assert.equal((await submit()).status,200);
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
  const applications=(await db.query('select id,status,experience_level from public.applicants')).rows;assert.equal(applications.length,1);assert.equal(applications[0].status,'new');assert.equal(applications[0].experience_level,'under_one');
  const attribution=(await db.query('select employee_id,application_id from public.referral_attributions')).rows;assert.deepEqual(attribution,[{employee_id:employee,application_id:applications[0].id}]);
  const onboard=(await db.query('select * from public.start_employee_onboarding($1)',[applications[0].id])).rows[0];assert.equal(onboard.result,'created');
  assert.equal((await db.query('select status from public.applicants where id=$1',[applications[0].id])).rows[0].status,'hired');
  assert.equal((await db.query('select * from public.onboarding_tasks where onboarding_id=$1',[onboard.onboarding_id])).rows.length,3);
  assert.equal((await db.query('select count(*)::int as n from public.application_notifications')).rows[0].n,1);
  await db.exec(`select set_config('request.jwt.claim.sub','${employee}',false)`);
  assert.equal((await db.query('select * from public.applicants')).rows.length,0);assert.equal((await db.query('select * from public.onboarding_tasks')).rows.length,0);
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);await assert.rejects(db.query('select * from public.start_employee_onboarding($1)',[applications[0].id]));
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,3,'no employee login was created');
  assert.equal(calls.length,2,'duplicate retry can trigger another bounded queue attempt; outbox remains singular');
 }finally{await db.close()}
});
