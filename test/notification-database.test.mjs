import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('application notifications are atomic, private, leased and safely retried', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
  const first=(await readFile(new URL('../supabase/migrations/20261117000000_intake_foundation.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
  await db.exec(first);await db.exec(await readFile(new URL('../supabase/migrations/20261117010000_application_notifications.sql',import.meta.url),'utf8'));
  const owner='11111111-1111-4111-8111-111111111111', stranger='22222222-2222-4222-8222-222222222222';
  await db.exec(`insert into auth.users values ('${owner}'),('${stranger}'); insert into public.owner_memberships values ('${owner}',now());`);
  await db.exec(`set role service_role; insert into public.applicants(request_id, request_hash, first_name, phone, area, shifts, transportation, languages, sms_consent, sms_consent_version, form_language) values ('33333333-3333-4333-8333-333333333333',repeat('a',64),'Example','3375550199','Example',array['nights'],true,array['en'],false,'application-v1','en'); reset role;`);
  assert.equal((await db.query('select count(*)::int as n from public.application_notifications')).rows[0].n,1);
  await db.exec(`set role anon;`);await assert.rejects(db.query('select public.claim_application_notification()'));await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${stranger}',false);`);
  assert.equal((await db.query('select id from public.application_notifications')).rows.length,0);
  await assert.rejects(db.query('select public.claim_application_notification()'));
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
  assert.equal((await db.query('select id,status from public.application_notifications')).rows.length,1);
  await assert.rejects(db.query('select lease_token from public.application_notifications'));
  await assert.rejects(db.query("update public.application_notifications set status='sent'"));
  await db.exec('reset role; set role service_role;');
  let job=(await db.query('select * from public.claim_application_notification()')).rows[0];assert.equal(job.first_name,'Example');
  assert.equal((await db.query('select * from public.claim_application_notification()')).rows.length,0);
  assert.equal((await db.query(`select public.finish_application_notification('${job.notification_id}','${job.claim_token}',false) as ok`)).rows[0].ok,true);
  assert.equal((await db.query('select * from public.claim_application_notification()')).rows.length,0, 'backoff prevents immediate retry');
  await db.exec(`reset role; update public.application_notifications set available_at=now()-interval '1 second'; set role service_role;`);
  const second=(await db.query('select * from public.claim_application_notification()')).rows[0];assert.notEqual(second.claim_token,job.claim_token);
  assert.equal((await db.query(`select public.finish_application_notification('${job.notification_id}','${job.claim_token}',true) as ok`)).rows[0].ok,false, 'old lease cannot finish');
  assert.equal((await db.query(`select public.finish_application_notification('${second.notification_id}','${second.claim_token}',true) as ok`)).rows[0].ok,true);
  await db.exec('reset role');assert.equal((await db.query('select status from public.application_notifications')).rows[0].status,'sent');
  // A failed applicant insert rolls its outbox write back too.
  await db.exec('begin');
  await db.exec(`insert into public.applicants(request_id,request_hash,first_name,phone,area,shifts,transportation,languages,sms_consent,sms_consent_version,form_language) values ('55555555-5555-4555-8555-555555555555',repeat('b',64),'Test','3375550199','Test',array['days'],true,array['en'],false,'application-v1','en')`);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from public.application_notifications')).rows[0].n,1);
  // A crashed worker loses its lease, and the eighth failed attempt becomes visible for intervention.
  await db.exec("update public.application_notifications set status='processing', attempts=7, locked_at=now()-interval '3 minutes', lease_token='66666666-6666-4666-8666-666666666666', sent_at=null; set role service_role");
  assert.equal((await db.query(`select public.finish_application_notification('${job.notification_id}','66666666-6666-4666-8666-666666666666',true) as ok`)).rows[0].ok,false);
  const finalJob=(await db.query('select * from public.claim_application_notification()')).rows[0];
  assert.ok(finalJob);assert.equal((await db.query(`select public.finish_application_notification('${finalJob.notification_id}','${finalJob.claim_token}',false) as ok`)).rows[0].ok,true);
  await db.exec('reset role');assert.equal((await db.query('select status from public.application_notifications')).rows[0].status,'failed');
 } finally {await db.close()}
});
