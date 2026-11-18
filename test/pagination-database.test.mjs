import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('owner keyset pages retain equal-timestamp records without duplicates',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for(const file of ['20261117000000_intake_foundation.sql','20261117050000_owner_pagination.sql']) await db.exec((await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  const owner='11111111-1111-4111-8111-111111111111';
  await db.exec(`insert into auth.users values ('${owner}');insert into public.owner_memberships(user_id) values ('${owner}');
   insert into public.applicants(request_id,request_hash,first_name,phone,area,shifts,transportation,languages,sms_consent,sms_consent_version,form_language,created_at)
   select gen_random_uuid(),repeat('a',64),'Example','3375550199','Example',array['days'],true,array['en'],false,'application-v1','en','2026-11-17T10:11:12.123456Z'::timestamptz from generate_series(1,55);
   set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
  let after=null, seen=[];
  for(;;){
   const results=after?await db.query('select id,created_at::text as created from public.applicants where created_at < $1::timestamptz or (created_at = $1::timestamptz and id < $2::uuid) order by created_at desc,id desc limit 25',after):await db.query('select id,created_at::text as created from public.applicants order by created_at desc,id desc limit 25');
   if(!results.rows.length)break;
   seen.push(...results.rows.map(r=>r.id));const last=results.rows.at(-1);after=[last.created,last.id];
  }
  assert.equal(seen.length,55);assert.equal(new Set(seen).size,55);
 }finally{await db.close()}
});
