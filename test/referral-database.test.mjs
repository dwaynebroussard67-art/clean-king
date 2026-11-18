import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111';
const employee='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const request='44444444-4444-4444-8444-444444444444';
const hash='a'.repeat(64), contentHash='b'.repeat(64);
const row={request_id:request,request_hash:contentHash,first_name:'Example',phone:'3375550199',area:'Example',shifts:['nights'],transportation:true,languages:['en'],referrer:null,sms_consent:false,sms_consent_version:'application-v1',form_language:'en',consented_at:null,experience_level:'one_to_three',commercial_experience:'yes',residential_experience:null,equipment_experience:'no',training_willingness:'yes'};

test('referral attribution is private, atomic, single-use, and idempotent', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
   grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
  for (const file of ['20261117000000_intake_foundation.sql','20261117010000_application_notifications.sql','20261117030000_referral_foundation.sql','20261117040000_application_experience.sql']) {
   let sql=await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
   await db.exec(sql.replace('create extension if not exists pgcrypto;',''));
  }
  await db.exec(`insert into auth.users values ('${owner}'),('${employee}'),('${other}'); insert into public.owner_memberships(user_id) values ('${owner}'); insert into public.employee_memberships(user_id) values ('${employee}');`);
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select * from public.referral_attributions`));
  await assert.rejects(db.query(`select public.create_employee_invitation($1,$2)`,[employee,hash]));
  await assert.rejects(db.query(`select public.submit_referred_application($1::jsonb,$2)`,[JSON.stringify(row),hash]));
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${other}',false)`);
  await assert.rejects(db.query('select public.create_employee_invitation($1,$2)',[other,hash]));
  assert.equal((await db.query('select * from public.employee_memberships')).rows.length,0);
  await db.exec(`select set_config('request.jwt.claim.sub','${employee}',false)`);
  await assert.rejects(db.query('select public.create_employee_invitation($1,$2)',[employee,hash]));
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query('select public.create_employee_invitation($1,$2) as result',[other,hash])).rows[0].result,null);
  assert.ok((await db.query('select public.create_employee_invitation($1,$2) as result',[employee,hash])).rows[0].result);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${employee}',false)`);
  await assert.rejects(db.query('select * from public.referral_invitations'));
  assert.equal((await db.query('select * from public.referral_attributions')).rows.length,0);
  await assert.rejects(db.query('select public.submit_referred_application($1::jsonb,$2)',[JSON.stringify(row),hash]));
  assert.deepEqual((await db.query('select * from public.employee_referral_totals()')).rows,[{created:1,submitted:0}]);
  await db.exec(`reset role; set role service_role`);
  const submit=(data,code=hash)=>db.query('select public.submit_referred_application($1::jsonb,$2) as result',[JSON.stringify(data),code]);
  assert.equal((await submit(row,'c'.repeat(64))).rows[0].result,'invalid');
  assert.equal((await submit(row)).rows[0].result,'inserted');
  assert.equal((await submit(row)).rows[0].result,'duplicate');
  assert.equal((await submit({...row,request_hash:'d'.repeat(64)})).rows[0].result,'conflict');
  assert.equal((await submit({...row,request_id:'55555555-5555-4555-8555-555555555555'})).rows[0].result,'invalid');
  await db.exec('reset role');
  const stored=(await db.query('select * from public.applicants')).rows; assert.equal(stored.length,1);
  assert.equal(stored[0].experience_level,'one_to_three'); assert.equal(stored[0].commercial_experience,'yes'); assert.equal(stored[0].residential_experience,null);
  assert.equal((await db.query('select * from public.application_notifications')).rows.length,1);
  assert.equal((await db.query('select * from public.referral_attributions')).rows[0].employee_id,employee);
  assert.equal((await db.query("select * from public.audit_log where action='referral_attributed'")).rows.length,1);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${employee}',false)`);
  assert.deepEqual((await db.query('select * from public.employee_referral_totals()')).rows,[{created:1,submitted:1}]);
  assert.equal((await db.query('select * from public.referral_attributions')).rows.length,0);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await db.query('select * from public.referral_attributions')).rows.length,1);
  await db.exec(`reset role; insert into public.referral_invitations(employee_id,code_hash,created_at,expires_at) values ('${employee}',repeat('e',64),now()-interval '8 days',now()-interval '1 day'); set role service_role`);
  assert.equal((await submit({...row,request_id:'66666666-6666-4666-8666-666666666666'},'e'.repeat(64))).rows[0].result,'invalid');
  await db.exec(`reset role; insert into public.employee_memberships(user_id) values ('${other}'); set role service_role`);
  for(let i=0;i<10;i++) assert.ok((await db.query('select public.create_employee_invitation($1,$2) as result',[other,i.toString(16).padStart(64,'0')])).rows[0].result);
  assert.equal((await db.query('select public.create_employee_invitation($1,$2) as result',[other,'1'.repeat(64)])).rows[0].result,null);
  await db.exec(`reset role; insert into public.referral_invitations(employee_id,code_hash,expires_at) values ('${employee}',repeat('f',64),now()+interval '1 day'); set role service_role`);
  const retryRow={...row,request_id:'77777777-7777-4777-8777-777777777777'};
  await assert.rejects(submit({...retryRow,first_name:''},'f'.repeat(64)));
  assert.equal((await submit(retryRow,'f'.repeat(64))).rows[0].result,'inserted');
  await db.exec(`reset role; update public.employee_memberships set active=false where user_id='${employee}'; set role authenticated; select set_config('request.jwt.claim.sub','${employee}',false)`);
  await assert.rejects(db.query('select public.create_employee_invitation($1,$2)',[employee,'f'.repeat(64)]));
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query('select public.create_employee_invitation($1,$2) as result',[employee,'f'.repeat(64)])).rows[0].result,null);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${employee}',false)`);
  assert.deepEqual((await db.query('select * from public.employee_referral_totals()')).rows,[{created:0,submitted:0}]);
 } finally {await db.close()}
});
