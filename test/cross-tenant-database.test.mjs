import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Cross-tenant isolation: two franchises in one project must not see each other's
// applicants, leads, audit events, referral invitations or employee memberships.
// This exercises the real RLS policies with the real JWT-claim harness, not mocks.

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const EMP_A = '33333333-3333-4333-8333-333333333333';
const EMP_B1 = '44444444-4444-4444-8444-444444444444';
const EMP_B2 = '55555555-5555-4555-8555-555555555555';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APP_A = '66666666-6666-4666-8666-666666666666';
const APP_B = '77777777-7777-4777-8777-777777777777';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL(file, folder), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
  }
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4),($5)', [OWNER_A, OWNER_B, EMP_A, EMP_B1, EMP_B2]);
  await db.query(`insert into public.organizations(id,name,slug,owner_id,origin,status) values
    ('${ORG_A}','Franchise A','franchise-a','${OWNER_A}','https://a.example.test','active'),
    ('${ORG_B}','Franchise B','franchise-b','${OWNER_B}','https://b.example.test','active');`);
  await db.query('insert into public.owner_memberships(user_id, organization_id) values ($1,$3),($2,$4)', [OWNER_A, OWNER_B, ORG_A, ORG_B]);
  await db.query('insert into public.employee_memberships(user_id, organization_id) values ($1,$4),($2,$5),($3,$5)', [EMP_A, EMP_B1, EMP_B2, ORG_A, ORG_B]);
  // One applicant and one lead per franchise, seeded as the service role.
  await db.query(`insert into public.applicants(id,request_id,request_hash,organization_id,first_name,phone,area,shifts,transportation,languages,sms_consent,sms_consent_version,form_language)
    values ('${APP_A}','${APP_A}',repeat('a',64),'${ORG_A}','Alpha','3375550100','A-town',array['nights'],true,array['en'],false,'v1','en'),
           ('${APP_B}','${APP_B}',repeat('b',64),'${ORG_B}','Beta','3375550101','B-town',array['days'],true,array['en'],false,'v1','en');`);
  await db.query(`insert into public.leads(request_id,request_hash,organization_id,building_type,size,frequency,contact_name,phone,email)
    values ('${APP_A}',repeat('c',64),'${ORG_A}','office','unsure','weekly','A-contact','3375550102','a@example.com'),
           ('${APP_B}',repeat('d',64),'${ORG_B}','hospital','unsure','custom','B-contact','3375550103','b@example.com');`);
  return db;
}

async function as(db, role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}

test('owner A cannot read, update or audit across the franchise boundary', async () => {
  const db = await setup();
  try {
    // Seed one audit event in each franchise via the intake trigger (table owner).
    await db.exec('reset role');
    await db.query('update public.applicants set school_cleared = true where id = $1', [APP_A]);
    await db.query('update public.applicants set school_cleared = true where id = $1', [APP_B]);

    await as(db, 'authenticated', OWNER_A);
    const apps = (await db.query('select id from public.applicants')).rows;
    assert.deepEqual(apps.map((r) => r.id), [APP_A]);
    const leads = (await db.query('select contact_name from public.leads')).rows;
    assert.deepEqual(leads.map((r) => r.contact_name), ['A-contact']);
    // Cross-tenant write attempt: zero rows, no error oracle.
    const updated = (await db.query('update public.applicants set school_cleared = false where id = $1 returning id', [APP_B])).rows;
    assert.equal(updated.length, 0);
    const audit = (await db.query('select entity_id from public.audit_log')).rows;
    assert.ok(audit.length >= 1);
    assert.ok(audit.every((r) => r.entity_id === APP_A));

    await as(db, 'authenticated', OWNER_B);
    const appsB = (await db.query('select id from public.applicants')).rows;
    assert.deepEqual(appsB.map((r) => r.id), [APP_B]);
    const auditB = (await db.query('select entity_id from public.audit_log')).rows;
    assert.ok(auditB.every((r) => r.entity_id === APP_B));
  } finally {
    await db.close();
  }
});

test('referral invitations and attribution are franchise-scoped', async () => {
  const db = await setup();
  try {
    await as(db, 'service_role');
    await db.query('select public.create_employee_invitation($1,$2,$3) as result', [ORG_A, EMP_A, 'f'.repeat(64)]);
    await db.query('select public.create_employee_invitation($1,$2,$3) as result', [ORG_B, EMP_B1, 'a'.repeat(64)]);

    // Owners cannot read the raw invitation table at all (it is service-role only by design);
    // cross-tenant attribution visibility is proven through the attribution view instead.
    await as(db, 'authenticated', OWNER_A);
    await assert.rejects(db.query('select * from public.referral_invitations'), { code: '42501' });

    await as(db, 'service_role');
    const application = {
      request_id: '88888888-8888-4888-8888-888888888888',
      request_hash: 'e'.repeat(64),
      first_name: 'Referred', phone: '3375550111', area: 'A-town',
      shifts: ['nights'], transportation: true, languages: ['en'], referrer: null,
      sms_consent: false, sms_consent_version: 'v1', form_language: 'en', consented_at: null,
    };
    const submitted = (await db.query('select public.submit_referred_application($1::jsonb,$2,$3) as result', [JSON.stringify(application), 'f'.repeat(64), ORG_A])).rows[0].result;
    assert.equal(submitted, 'inserted');

    await as(db, 'authenticated', OWNER_A);
    const rowsA = (await db.query('select organization_id from public.referral_attributions')).rows;
    assert.deepEqual(rowsA.map((r) => r.organization_id), [ORG_A]);

    await as(db, 'authenticated', OWNER_B);
    await assert.rejects(db.query('select * from public.referral_invitations'), { code: '42501' });
    const rowsB = (await db.query('select organization_id from public.referral_attributions')).rows;
    assert.deepEqual(rowsB, []);
  } finally {
    await db.close();
  }
});

test('an owner of two franchises reads both; an owner of one sees neither other row', async () => {
  const db = await setup();
  try {
    // OWNER_A becomes a member of franchise B as well (multi-franchise owner).
    await db.exec('reset role');
    await db.query('insert into public.owner_memberships(user_id, organization_id) values ($1, $2)', [OWNER_A, ORG_B]);
    await as(db, 'authenticated', OWNER_A);
    const apps = (await db.query('select id from public.applicants order by id')).rows.map((r) => r.id);
    assert.deepEqual(apps.sort(), [APP_A, APP_B].sort());
    const leads = (await db.query('select organization_id from public.leads order by organization_id')).rows.map((r) => r.organization_id);
    assert.deepEqual(leads.sort(), [ORG_A, ORG_B].sort());
    // Emergency stop hides everything again, even for the multi-franchise owner.
    await db.exec("reset role; update public.owner_access_control set enabled = false where singleton");
    await as(db, 'authenticated', OWNER_A);
    assert.equal((await db.query('select public.owns_organization($1) as ok', [ORG_A])).rows[0].ok, false);
    assert.equal((await db.query('select public.owns_organization($1) as ok', [ORG_B])).rows[0].ok, false);
    assert.equal((await db.query('select * from public.applicants')).rows.length, 0);
    await db.exec('reset role; update public.owner_access_control set enabled = true where singleton');
  } finally {
    await db.close();
  }
});

test('employees see only their own membership row, never a colleague’s', async () => {
  const db = await setup();
  try {
    await as(db, 'authenticated', EMP_B1);
    const rows = (await db.query('select user_id from public.employee_memberships')).rows;
    assert.deepEqual(rows.map((r) => r.user_id), [EMP_B1]);
    assert.equal((await db.query('select count(*)::int as n from public.employee_memberships where user_id = $1', [EMP_B2])).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('a suspended franchise locks its owner out on the next statement', async () => {
  const db = await setup();
  try {
    await db.exec(`reset role; update public.organizations set status = 'suspended' where id = '${ORG_A}'`);
    await as(db, 'authenticated', OWNER_A);
    assert.equal((await db.query('select public.is_business_owner() as ok')).rows[0].ok, false);
    assert.equal((await db.query('select * from public.applicants')).rows.length, 0);
    assert.equal((await db.query('select public.current_organization_id() as org')).rows[0].org, null);
    await as(db, 'authenticated', OWNER_B);
    assert.equal((await db.query('select public.is_business_owner() as ok')).rows[0].ok, true);
    assert.equal((await db.query('select * from public.applicants')).rows.length, 1);
  } finally {
    await db.close();
  }
});
