import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('intake migration enforces owner membership, column permissions and audit logging', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
    // PGlite includes gen_random_uuid but does not ship the pgcrypto extension.
    const intakeMigration = (await readFile(new URL('../supabase/migrations/20261117000000_intake_foundation.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(intakeMigration);
    // Apply the multi-franchise organizations migration so tests run against the
    // current schema. PGlite has no pgcrypto, but the organizations migration does
    // not use it; add column if not exists guards re-runs.
    const orgMigration = (await readFile(new URL('../supabase/migrations/20261121030000_organizations_multi_franchise.sql', import.meta.url), 'utf8'));
    // The organizations migration references auth.users; PGlite already has that table.
    await db.exec(orgMigration);
    const owner='11111111-1111-4111-8111-111111111111', stranger='22222222-2222-4222-8222-222222222222';
    const orgId='33333333-3333-4333-8333-333333333333';
    await db.exec(`insert into auth.users values ('${owner}'), ('${stranger}'); insert into public.owner_memberships(user_id, organization_id) values ('${owner}','${orgId}'); insert into public.organizations(id, name, slug, owner_id, origin, status) values ('${orgId}','Test Franchise','test-franchise','${owner}','https://example.test','active');`);
    await db.exec(`set role service_role; insert into public.applicants(request_id, request_hash, organization_id, first_name, phone, area, shifts, transportation, languages, sms_consent, sms_consent_version, form_language, consented_at) values ('44444444-4444-4444-8444-444444444444',repeat('a',64),'${orgId}','Example','3375550199','Example',array['nights'],true,array['en'],true,'application-v1','en',now()); reset role;`);
    await db.exec(`set role service_role; insert into public.leads(request_id, request_hash, organization_id, building_type, size, frequency, contact_name, phone, email) values ('55555555-5555-4555-8555-555555555555',repeat('b',64),'${orgId}','hospital','unsure','weekly','Example','3375550199','test@example.com'); reset role;`);
    await db.exec(`set role anon;`);
    await assert.rejects(db.query('select * from public.applicants'));
    await assert.rejects(db.query('select public.is_business_owner()'));
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${stranger}',false);`);
    assert.equal((await db.query('select * from public.applicants')).rows.length,0);
    assert.equal((await db.query('select * from public.leads')).rows.length,0);
    assert.equal((await db.query("update public.leads set status='closed' returning id")).rows.length,0);
    assert.equal((await db.query("update public.applicants set status='hired' returning id")).rows.length,0);
    await assert.rejects(db.query(`insert into public.owner_memberships(user_id) values ('${stranger}')`));
    await assert.rejects(db.query(`insert into public.audit_log(entity_type,entity_id,action) values ('fake','${stranger}','fake')`));
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
    assert.equal((await db.query('select * from public.applicants')).rows.length,1);
    await assert.rejects(db.query("update public.applicants set first_name='Changed'"));
    await db.query("update public.applicants set school_cleared=true, status='later'");
    const audit=await db.query('select actor_id, entity_type, details from public.audit_log');
    assert.equal(audit.rows.length,1); assert.equal(audit.rows[0].actor_id,owner); assert.equal(audit.rows[0].entity_type,'applicant');
    assert.equal(audit.rows[0].details.new_school_cleared,true); assert.equal(audit.rows[0].details.new_status,'later');
    await db.query("update public.applicants set status='later'");
    assert.equal((await db.query('select * from public.audit_log')).rows.length,1);
    await db.query("update public.leads set status='contacted'");
    const leadAudit=await db.query("select details from public.audit_log where entity_type='lead'");
    assert.equal(leadAudit.rows.length,1); assert.equal(leadAudit.rows[0].details.new_status,'contacted');
    await assert.rejects(db.query("update public.leads set email='other@example.com'"));
  } finally { await db.close(); }
});
