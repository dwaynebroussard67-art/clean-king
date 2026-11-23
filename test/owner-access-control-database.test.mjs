import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const DENIED = { code: '42501' };
const ORG = '55555555-5555-4555-8555-555555555555';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(folder)).filter(x => x.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL(name, folder), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
  }
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [OWNER, SECOND, EMPLOYEE]);
  await db.query("insert into public.organizations(id,name,slug,owner_id,origin,status) values($1,'Test Franchise','test-franchise',$2,'https://example.test','active')", [ORG, OWNER]);
  await db.query('insert into public.owner_memberships(user_id,organization_id) values ($1,$3),($2,$3)', [OWNER, SECOND, ORG]);
  await db.query('insert into public.employee_memberships(user_id,organization_id) values ($1,$2)', [EMPLOYEE, ORG]);
  await db.exec(`insert into public.applicants(request_id,request_hash,organization_id,first_name,phone,area,shifts,transportation,languages,sms_consent,sms_consent_version,form_language)
    values ('${REQUEST}',repeat('a',64),'${ORG}','Example','3375550199','Example',array['nights'],true,array['en'],false,'v1','en');`);
  return db;
}
async function as(db, role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec(`set role ${role}`);
}

test('owner emergency stop and individual suspension block direct RLS and owner RPC access', async () => {
  const db = await setup();
  try {
    const id = (await db.query('select id from public.applicants')).rows[0].id;
    await as(db, 'authenticated', OWNER);
    assert.equal((await db.query('select public.is_business_owner() as allowed')).rows[0].allowed, true);
    assert.equal((await db.query('select user_id from public.owner_memberships')).rows.length, 1);
    assert.equal((await db.query('select id from public.applicants')).rows.length, 1);
    await assert.rejects(db.query('select * from public.owner_access_control'), DENIED);
    await assert.rejects(db.query('update public.owner_access_control set enabled=false'), DENIED);
    await assert.rejects(db.query('update public.owner_memberships set active=true'), DENIED);
    await as(db, 'service_role');
    await assert.rejects(db.query('update public.owner_access_control set enabled=false'), DENIED);
    await assert.rejects(db.query('update public.owner_memberships set active=true'), DENIED);

    await db.exec('reset role; update public.owner_access_control set enabled=false');
    for (const owner of [OWNER, SECOND]) {
      await as(db, 'authenticated', owner);
      assert.equal((await db.query('select public.is_business_owner() as allowed')).rows[0].allowed, false);
      assert.equal((await db.query('select user_id from public.owner_memberships')).rows.length, 0);
      assert.equal((await db.query('select id from public.applicants')).rows.length, 0);
      assert.equal((await db.query('update public.applicants set school_cleared=true returning id')).rows.length, 0);
      await assert.rejects(db.query('select public.set_applicant_status($1,$2)', [id, 'later']), DENIED);
      await assert.rejects(db.query('select * from public.get_assistant_settings()'), DENIED);
      await assert.rejects(db.query('select * from public.begin_assistant_run()'), DENIED);
    }
    // Employee self-service is intentionally a separate boundary.
    await as(db, 'authenticated', EMPLOYEE);
    assert.equal((await db.query('select user_id from public.employee_memberships')).rows.length, 1);
    await db.exec('reset role; update public.owner_access_control set enabled=true');
    await db.query('update public.owner_memberships set active=false where user_id=$1', [OWNER]);
    await as(db, 'authenticated', OWNER);
    assert.equal((await db.query('select id from public.applicants')).rows.length, 0);
    await assert.rejects(db.query('select public.start_employee_onboarding($1)', [id]), DENIED);
    await as(db, 'authenticated', SECOND);
    assert.equal((await db.query('select id from public.applicants')).rows.length, 1);
    await db.exec('reset role; delete from public.owner_access_control');
    await as(db, 'authenticated', SECOND);
    assert.equal((await db.query('select public.is_business_owner() as allowed')).rows[0].allowed, false);
    assert.equal((await db.query('select id from public.applicants')).rows.length, 0);
    await db.exec('reset role');
    const events = (await db.query("select action,actor_id,details from public.audit_log where entity_type='owner_access' order by id")).rows;
    assert.deepEqual(events.map(x => x.action), ['global_access_changed', 'global_access_changed', 'owner_access_changed']);
    assert.ok(events.every(x => x.actor_id === null));
    assert.deepEqual(events.map(x => x.details), [{ enabled: false }, { enabled: true }, { active: false }]);
  } finally { await db.close(); }
});
