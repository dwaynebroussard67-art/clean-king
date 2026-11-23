import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const EMPLOYEE='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const REQUEST='33333333-3333-4333-8333-333333333333';
const DENIED={code:'42501'};
const ORG='44444444-4444-4444-8444-444444444444';
const row={request_id:REQUEST,request_hash:'a'.repeat(64),first_name:'Example',phone:'3375550199',area:'Example',shifts:['nights'],transportation:true,languages:['en'],referrer:null,sms_consent:false,sms_consent_version:'v1',form_language:'en',consented_at:null};
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
 const folder=new URL('../supabase/migrations/',import.meta.url);
 for(const name of (await readdir(folder)).filter(x=>x.endsWith('.sql')).sort()) await db.exec((await readFile(new URL(name,folder),'utf8')).replace('create extension if not exists pgcrypto;',''));
 await db.query('insert into auth.users(id) values($1),($2)',[EMPLOYEE,OTHER]);
 await db.query("insert into public.organizations(id,name,slug,owner_id,origin,status) values($1,'Test Franchise','test-franchise',$2,'https://example.test','active')",[ORG,EMPLOYEE]);
 await db.query('insert into public.employee_memberships(user_id,organization_id) values($1,$3),($2,$3)',[EMPLOYEE,OTHER,ORG]);
 return db;
}
async function as(db,role,id=''){
 await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec(`set role ${role}`);
}
test('employees can revoke only their own unused invitations; revoked codes cannot submit',async()=>{
 const db=await setup();
 try{
  const codes=['b','c','d','e'].map(c=>c.repeat(64));
  await as(db,'service_role');
  for(const code of codes) assert.ok((await db.query('select public.create_employee_invitation($1,$2,$3) as result',[ORG,EMPLOYEE,code])).rows[0].result);
  await db.exec('reset role');
  const all=(await db.query('select id,code_hash from public.referral_invitations')).rows;
  const id=code=>all.find(x=>x.code_hash===code).id;
  await db.query("update public.referral_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[id(codes[3])]);
  await as(db,'anon');
  await assert.rejects(db.query('select * from public.my_referral_invitations()'),DENIED);
  await assert.rejects(db.query('select public.revoke_my_referral_invitation($1)',[id(codes[0])]),DENIED);
  await as(db,'authenticated',OTHER);
  assert.equal((await db.query('select public.revoke_my_referral_invitation($1) as ok',[id(codes[0])])).rows[0].ok,false);
  assert.deepEqual((await db.query('select * from public.my_referral_invitations()')).rows,[]);
  await as(db,'authenticated',EMPLOYEE);
  const list=(await db.query('select * from public.my_referral_invitations()')).rows;
  assert.equal(list.length,4);
  assert.deepEqual(Object.keys(list[0]).sort(),['created_at','expires_at','id','status']);
  assert.equal(list.find(x=>x.id===id(codes[3])).status,'expired');
  assert.equal((await db.query('select public.revoke_my_referral_invitation($1) as ok',[id(codes[3])])).rows[0].ok,false);
  assert.equal((await db.query('select public.revoke_my_referral_invitation($1) as ok',[id(codes[0])])).rows[0].ok,true);
  assert.equal((await db.query('select public.revoke_my_referral_invitation($1) as ok',[id(codes[0])])).rows[0].ok,false);
  assert.equal((await db.query('select * from public.my_referral_invitations()')).rows.find(x=>x.id===id(codes[0])).status,'revoked');
  await as(db,'service_role');
  const submit=(data,code)=>db.query('select public.submit_referred_application($1::jsonb,$2,$3) as result',[JSON.stringify(data),code,ORG]);
  assert.equal((await submit(row,codes[0])).rows[0].result,'invalid');
  assert.equal((await submit(row,codes[1])).rows[0].result,'inserted');
  assert.equal((await submit(row,codes[1])).rows[0].result,'duplicate');
  await as(db,'authenticated',EMPLOYEE);
  assert.equal((await db.query('select public.revoke_my_referral_invitation($1) as ok',[id(codes[1])])).rows[0].ok,false);
  assert.equal((await db.query('select * from public.my_referral_invitations()')).rows.find(x=>x.id===id(codes[1])).status,'submitted');
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int as count from public.audit_log where action='revoked'")).rows[0].count,1);
  await db.query('update public.employee_memberships set active=false where user_id=$1',[EMPLOYEE]);
  await as(db,'authenticated',EMPLOYEE);
  assert.equal((await db.query('select public.revoke_my_referral_invitation($1) as ok',[id(codes[2])])).rows[0].ok,false);
  assert.deepEqual((await db.query('select * from public.my_referral_invitations()')).rows,[]);
 }finally{await db.close()}
});

test('the bounded list prioritizes still-usable links ahead of newer history',async()=>{
 const db=await setup();
 try {
  await db.query(`insert into public.referral_invitations(employee_id,organization_id,code_hash,created_at,expires_at,revoked_at)
    select $1, $2, repeat('f',32)||md5(n::text), now()-interval '1 hour', now()+interval '1 day', now()
    from generate_series(1,120) n`,[EMPLOYEE,ORG]);
  const active=(await db.query(`insert into public.referral_invitations(employee_id,organization_id,code_hash,created_at,expires_at)
    values($1,$2,repeat('a',64),now()-interval '2 days',now()+interval '1 day') returning id`,[EMPLOYEE,ORG])).rows[0].id;
  await as(db,'authenticated',EMPLOYEE);
  const rows=(await db.query('select * from public.my_referral_invitations()')).rows;
  assert.equal(rows.length,100); assert.equal(rows[0].id,active); assert.equal(rows[0].status,'active');
  assert.ok(rows.slice(1).every(x=>x.status==='revoked'));
 } finally {await db.close()}
});
