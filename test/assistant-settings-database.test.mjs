import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('settings and reduced budget are owner-only, validated and audited',async()=>{
 const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for(const f of ['20261117000000_intake_foundation.sql','20261117020000_assistant_usage.sql','20261117080000_assistant_settings.sql'])await db.exec((await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  await db.exec(`insert into auth.users values('${owner}'),('${other}');insert into public.owner_memberships(user_id) values('${owner}');set role anon`);
  await assert.rejects(db.query('select provider from public.assistant_settings'));await assert.rejects(db.query("select public.update_assistant_settings('A','open','calm',false,1,1)"));
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${other}',false)`);
  assert.equal((await db.query('select provider from public.assistant_settings')).rows.length,0);await assert.rejects(db.query("select public.update_assistant_settings('A','open','calm',false,1,1)"));
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await db.query('select provider,include_counts from public.assistant_settings')).rows[0].provider,'anthropic');
  await assert.rejects(db.query("update public.assistant_settings set per_month=999"));
  assert.equal((await db.query("select public.update_assistant_settings('A','open','calm',true,4,100) as ok")).rows[0].ok,false);
  assert.equal((await db.query("select public.update_assistant_settings('A','open','calm',true,1,2) as ok")).rows[0].ok,true);
  assert.equal((await db.query("select public.update_assistant_settings('A','open','calm',true,1,2) as ok")).rows[0].ok,true);
  assert.equal((await db.query("select count(*)::int n from public.audit_log where entity_type='assistant_settings'")).rows[0].n,1);
  assert.equal((await db.query('select result from public.begin_assistant_run()')).rows[0].result,'ok');
  assert.equal((await db.query('select result from public.begin_assistant_run()')).rows[0].result,'rate_limit');
  await db.exec(`reset role;update public.assistant_runs set created_at=now()-interval '2 minutes';set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await db.query('select result from public.begin_assistant_run()')).rows[0].result,'ok');
  await db.exec(`reset role;update public.assistant_runs set created_at=now()-interval '2 minutes';set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await db.query('select result from public.begin_assistant_run()')).rows[0].result,'monthly_limit');
 }finally{await db.close()}
});
