import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { parseIntake, toRow } from '../lib/intake.mjs';

test('unreferred applicant experience persists and remains owner-only in the local database', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for(const file of ['20261117000000_intake_foundation.sql','20261117010000_application_notifications.sql','20261117030000_referral_foundation.sql','20261117040000_application_experience.sql']) {
   await db.exec((await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  }
  const owner='11111111-1111-4111-8111-111111111111', stranger='22222222-2222-4222-8222-222222222222';
  await db.exec(`insert into auth.users values ('${owner}'),('${stranger}'); insert into public.owner_memberships(user_id) values ('${owner}'); set role service_role`);
  const parsed=parseIntake({kind:'application',formLanguage:'es',requestId:'33333333-3333-4333-8333-333333333333',token:'mock',data:{firstName:'Ejemplo',phone:'3375550199',area:'Ejemplo',shifts:['days'],transportation:'yes',languages:['es'],referrer:'',smsConsent:false,experienceLevel:'under_one',commercialExperience:'yes',residentialExperience:'no',equipmentExperience:null,trainingWillingness:'unsure'}});
  const row={...toRow(parsed),request_hash:'a'.repeat(64)};
  const columns=Object.keys(row); const values=Object.values(row);
  await db.query(`insert into public.applicants (${columns.join(',')}) values (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,values);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${stranger}',false)`);
  assert.equal((await db.query('select * from public.applicants')).rows.length,0);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  const result=(await db.query('select experience_level,commercial_experience,residential_experience,equipment_experience,training_willingness from public.applicants')).rows[0];
  assert.deepEqual(result,{experience_level:'under_one',commercial_experience:'yes',residential_experience:'no',equipment_experience:null,training_willingness:'unsure'});
  await assert.rejects(db.query("update public.applicants set experience_level='over_three'"));
  await db.exec('reset role; set role service_role');
  const bad={...row,request_id:'44444444-4444-4444-8444-444444444444',experience_level:'invalid'};
  await assert.rejects(db.query(`insert into public.applicants (${columns.join(',')}) values (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(k=>bad[k])));
  await db.exec('reset role');
  assert.equal((await db.query('select * from public.application_notifications')).rows.length,1);
 } finally {await db.close()}
});
