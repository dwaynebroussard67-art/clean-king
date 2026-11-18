import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111',stranger='22222222-2222-4222-8222-222222222222';
const app='33333333-3333-4333-8333-333333333333',passed='44444444-4444-4444-8444-444444444444',legacy='55555555-5555-4555-8555-555555555555';

test('onboarding is owner-only, atomic, auditable and does not create an active employee account',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for(const file of ['20261117000000_intake_foundation.sql','20261117010000_application_notifications.sql','20261117030000_referral_foundation.sql','20261117040000_application_experience.sql','20261117070000_owner_onboarding.sql']) await db.exec((await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  await db.exec(`insert into auth.users values ('${owner}'),('${stranger}');insert into public.owner_memberships(user_id) values ('${owner}');
  insert into public.applicants(id,request_id,request_hash,first_name,phone,area,shifts,transportation,languages,sms_consent,sms_consent_version,form_language,status)
  values ('${app}',gen_random_uuid(),repeat('a',64),'Example','3375550199','Example',array['days'],true,array['en'],false,'application-v1','en','new'),('${passed}',gen_random_uuid(),repeat('b',64),'Example','3375550199','Example',array['days'],true,array['en'],false,'application-v1','en','passed'),('${legacy}',gen_random_uuid(),repeat('c',64),'Example','3375550199','Example',array['days'],true,array['en'],false,'application-v1','en','hired');`);
  await db.exec('set role anon');await assert.rejects(db.query('select * from public.employee_onboarding'));await assert.rejects(db.query('select * from public.start_employee_onboarding($1)',[app]));
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${stranger}',false)`);
  assert.equal((await db.query('select * from public.employee_onboarding')).rows.length,0);
  await assert.rejects(db.query('select * from public.start_employee_onboarding($1)',[app]));
  await assert.rejects(db.query('select public.set_applicant_status($1,$2)',[app,'passed']));
  await assert.rejects(db.query('update public.applicants set status=$1 where id=$2',['hired',app]));
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  await assert.rejects(db.query('update public.applicants set status=$1 where id=$2',['hired',app]));
  assert.equal((await db.query('select public.set_applicant_status($1,$2) as ok',[app,'hired'])).rows[0].ok,false);
  assert.deepEqual((await db.query('select * from public.start_employee_onboarding($1)',[passed])).rows[0],{result:'ineligible',onboarding_id:null});
  assert.equal((await db.query('select public.set_applicant_status($1,$2) as ok',[passed,'new'])).rows[0].ok,true);
  // A failed checklist insertion must roll back the employee record, status and audit.
  await db.exec(`reset role;create function public.test_fail_task() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;create trigger test_fail_task before insert on public.onboarding_tasks for each row execute function public.test_fail_task();set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
  await assert.rejects(db.query('select * from public.start_employee_onboarding($1)',[passed]));
  assert.equal((await db.query('select status from public.applicants where id=$1',[passed])).rows[0].status,'new');
  assert.equal((await db.query('select * from public.employee_onboarding where applicant_id=$1',[passed])).rows.length,0);
  assert.equal((await db.query("select count(*)::int as n from public.audit_log where entity_type='onboarding' and action='started'")).rows[0].n,0);
  await db.exec(`reset role;drop trigger test_fail_task on public.onboarding_tasks;drop function public.test_fail_task();set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
  const first=(await db.query('select * from public.start_employee_onboarding($1)',[app])).rows[0];assert.equal(first.result,'created');assert.ok(first.onboarding_id);
  const retry=(await db.query('select * from public.start_employee_onboarding($1)',[app])).rows[0];assert.equal(retry.result,'existing');assert.equal(retry.onboarding_id,first.onboarding_id);
  assert.equal((await db.query('select status from public.applicants where id=$1',[app])).rows[0].status,'hired');
  assert.equal((await db.query('select public.set_applicant_status($1,$2) as ok',[app,'passed'])).rows[0].ok,false);
  assert.equal((await db.query('select * from public.onboarding_tasks where onboarding_id=$1',[first.onboarding_id])).rows.length,3);
  assert.equal((await db.query('select public.record_onboarding_task($1,$2,$3) as ok',[first.onboarding_id,'plan_training',true])).rows[0].ok,true);
  assert.equal((await db.query('select public.record_onboarding_task($1,$2,$3) as ok',[first.onboarding_id,'plan_training',true])).rows[0].ok,true);
  assert.equal((await db.query("select count(*)::int as n from public.audit_log where entity_type='onboarding' and action='task_updated'")).rows[0].n,1);
  assert.equal((await db.query('select public.record_onboarding_task($1,$2,$3) as ok',[first.onboarding_id,'plan_training',false])).rows[0].ok,true);
  const reset=(await db.query('select status,recorded_by,recorded_at from public.onboarding_tasks where onboarding_id=$1 and task_code=$2',[first.onboarding_id,'plan_training'])).rows[0];
  assert.deepEqual(reset,{status:'pending',recorded_by:null,recorded_at:null});
  assert.equal((await db.query("select count(*)::int as n from public.audit_log where entity_type='onboarding' and action='task_updated'")).rows[0].n,2);
  assert.equal((await db.query('select public.record_onboarding_task($1,$2,$3) as ok',[first.onboarding_id,'fake',true])).rows[0].ok,false);
  await assert.rejects(db.query("update public.onboarding_tasks set status='recorded'"));
  const legacyResult=(await db.query('select * from public.start_employee_onboarding($1)',[legacy])).rows[0];assert.equal(legacyResult.result,'created');
  await db.exec(`select set_config('request.jwt.claim.sub','${stranger}',false)`);
  assert.equal((await db.query('select * from public.employee_onboarding')).rows.length,0);assert.equal((await db.query('select * from public.onboarding_tasks')).rows.length,0);
  await assert.rejects(db.query('select public.record_onboarding_task($1,$2,$3)',[first.onboarding_id,'plan_training',false]));
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.employee_memberships')).rows[0].n,0,'no employee account was created or activated');
  assert.equal((await db.query('select count(*)::int as n from public.application_notifications')).rows[0].n,3);
 }finally{await db.close()}
});
