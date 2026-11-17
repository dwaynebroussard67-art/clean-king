import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('assistant budget and metadata are owner-only and fail closed',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
 const first=(await readFile(new URL('../supabase/migrations/20261117000000_intake_foundation.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');await db.exec(first);await db.exec(await readFile(new URL('../supabase/migrations/20261117020000_assistant_usage.sql',import.meta.url),'utf8'));
 const owner='11111111-1111-4111-8111-111111111111',stranger='22222222-2222-4222-8222-222222222222';await db.exec(`insert into auth.users values ('${owner}'),('${stranger}');insert into public.owner_memberships(user_id) values ('${owner}');set role anon;`);
 await assert.rejects(db.query('select * from public.begin_assistant_run()'));await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${stranger}',false);`);await assert.rejects(db.query('select * from public.begin_assistant_run()'));assert.equal((await db.query('select * from public.assistant_runs')).rows.length,0);
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);const run=(await db.query('select * from public.begin_assistant_run()')).rows[0];assert.equal(run.result,'ok');assert.equal((await db.query(`select public.finish_assistant_run('${run.run_id}',true) as ok`)).rows[0].ok,true);assert.equal((await db.query(`select public.finish_assistant_run('${run.run_id}',true) as ok`)).rows[0].ok,false);
 await db.query('select * from public.begin_assistant_run()');await db.query('select * from public.begin_assistant_run()');assert.equal((await db.query('select * from public.begin_assistant_run()')).rows[0].result,'rate_limit');await assert.rejects(db.query('delete from public.assistant_runs'));
 await db.exec(`reset role; update public.assistant_runs set created_at=now()-interval '2 minutes'; insert into public.assistant_runs(owner_id,created_at) select '${owner}', now()-interval '2 minutes' from generate_series(1,97); set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);assert.equal((await db.query('select * from public.begin_assistant_run()')).rows[0].result,'monthly_limit');
 }finally{await db.close()}
});
