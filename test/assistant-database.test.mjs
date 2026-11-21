import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_SETTINGS } from '../lib/assistant-settings-schema.mjs';
import { decryptSecret, encryptSecret, lastFour } from '../lib/server/secret-box.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const KEY = Buffer.alloc(32, 15).toString('base64');
const SECRET = 'synthetic-provider-key-8ZQK';
const BOX = encryptSecret(SECRET, KEY);
const LAST4 = lastFour(SECRET);
const DENIED = { code: '42501' };

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrations), 'utf8');
    await db.exec(sql.replace('create extension if not exists pgcrypto;', ''));
  }
  await db.query('insert into auth.users (id) values ($1), ($2)', [OWNER, STRANGER]);
  const ORG = '33333333-3333-4333-8333-333333333333';
  await db.query("insert into public.organizations (id, name, slug, owner_id, origin, status) values ($1, 'Test Franchise', 'test-franchise', $2, null, 'active')", [ORG, OWNER]);
  await db.query('insert into public.owner_memberships (user_id, organization_id) values ($1, $2)', [OWNER, ORG]);
  return db;
}

async function asRole(db, role, userId = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}

async function one(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

async function save(db, settings, version) {
  return one(db, 'select * from public.save_assistant_settings($1::jsonb, $2)', [JSON.stringify(settings), version]);
}

async function begin(db) {
  return one(db, 'select * from public.begin_assistant_run()');
}

test('assistant settings and secret RPCs are owner-only; errors and audit are content-free', async () => {
  const db = await database();
  try {
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.get_assistant_settings()'), DENIED);
    await assert.rejects(db.query('select * from public.assistant_settings'), DENIED);

    await asRole(db, 'authenticated', STRANGER);
    await assert.rejects(db.query('select * from public.get_assistant_settings()'), DENIED);
    assert.deepEqual((await db.query('select * from public.assistant_settings_audit')).rows, []);
    await assert.rejects(db.query('select * from public.get_assistant_secret($1)', ['anthropic']), DENIED);

    await asRole(db, 'authenticated', OWNER);
    assert.deepEqual((await db.query('select * from public.get_assistant_settings()')).rows, []);
    assert.deepEqual(await save(db, DEFAULT_SETTINGS, 1), { result: 'conflict', version: 0 });
    assert.deepEqual(await save(db, DEFAULT_SETTINGS, 0), { result: 'ok', version: 1 });
    assert.deepEqual(await one(db, 'select * from public.get_assistant_settings()'), {
      settings: DEFAULT_SETTINGS, version: 1,
    });
    for (const invalid of [
      null,
      { ...DEFAULT_SETTINGS, unknown: 'synthetic-sensitive-field' },
      { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, perMinute: 0 } },
      { ...DEFAULT_SETTINGS, provider: { ...DEFAULT_SETTINGS.provider, customBaseUrl: 'http://invalid.example' } },
    ]) assert.equal((await save(db, invalid, 1)).result, 'invalid');

    assert.equal((await one(db, 'select public.set_assistant_secret($1,$2,$3) as ok', ['anthropic', SECRET, LAST4])).ok, false);
    assert.equal((await one(db, 'select public.set_assistant_secret($1,$2,$3) as ok', ['anthropic', BOX, SECRET])).ok, false);
    assert.equal((await one(db, 'select public.set_assistant_secret($1,$2,$3) as ok', ['anthropic', BOX, LAST4])).ok, true);
    const stored = await one(db, 'select * from public.get_assistant_secret($1)', ['anthropic']);
    assert.deepEqual(stored, { ciphertext: BOX, last4: LAST4 });
    assert.equal(decryptSecret(stored.ciphertext, KEY), SECRET);
    await assert.rejects(db.query('select * from public.assistant_secrets'), DENIED);

    const audit = await db.query('select action, changed_keys, secret_name from public.assistant_settings_audit order by id');
    assert.deepEqual(audit.rows, [
      { action: 'settings_saved', changed_keys: ['enabled', 'limits', 'persona', 'provider', 'version', 'capabilities', 'voice'].sort(), secret_name: null },
      { action: 'secret_set', changed_keys: [], secret_name: 'anthropic' },
    ]);
    assert.doesNotMatch(JSON.stringify(audit.rows), /synthetic-provider-key|8ZQK|v1:/);
    assert.equal((await one(db, 'select public.clear_assistant_secret($1) as ok', ['anthropic'])).ok, true);
    assert.deepEqual((await db.query('select * from public.get_assistant_secret($1)', ['anthropic'])).rows, []);

    await asRole(db, 'service_role');
    await assert.rejects(db.query('select * from public.get_assistant_settings()'), DENIED);
    await assert.rejects(db.query('select * from public.assistant_settings'), DENIED);
  } finally {
    await db.close();
  }
});

test('assistant quota reads saved limits and cannot accept caller-selected limits', async () => {
  const db = await database();
  try {
    await db.exec('set role anon');
    await assert.rejects(begin(db), DENIED);
    await asRole(db, 'authenticated', STRANGER);
    await assert.rejects(begin(db), DENIED);

    await db.exec('reset role');
    const definition = (await one(db, "select pg_get_functiondef('public.begin_assistant_run()'::regprocedure) as source")).source;
    assert.ok(definition.indexOf('pg_advisory_xact_lock(1832711045)') < definition.indexOf("select s.settings->'limits'"));
    const triggers = await db.query("select tgname from pg_trigger where tgrelid='public.assistant_settings'::regclass and not tgisinternal");
    assert.ok(triggers.rows.some(row => row.tgname === 'assistant_settings_admission_lock'));
    await asRole(db, 'authenticated', OWNER);
    for (let index = 0; index < 3; index += 1) assert.equal((await begin(db)).result, 'ok');
    assert.deepEqual(await begin(db), { run_id: null, result: 'rate_limit' });
    await assert.rejects(db.query('select * from public.begin_assistant_run(10, 1000)'));

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.limits.perMinute = 1;
    settings.limits.perMonth = 2;
    assert.deepEqual(await save(db, settings, 0), { result: 'ok', version: 1 });
    await db.exec('reset role; update public.assistant_runs set created_at = now() - interval \'2 months\';');
    await asRole(db, 'authenticated', OWNER);
    const first = await begin(db);
    assert.equal(first.result, 'ok');
    assert.equal((await begin(db)).result, 'rate_limit');
    assert.equal((await one(db, 'select public.finish_assistant_run($1,$2) as ok', [first.run_id, true])).ok, true);
    await db.exec('reset role; update public.assistant_runs set created_at = now() - interval \'2 minutes\';');

    settings.limits.perMinute = 10;
    settings.limits.perMonth = 1;
    await asRole(db, 'authenticated', OWNER);
    assert.deepEqual(await save(db, settings, 1), { result: 'ok', version: 2 });
    assert.equal((await begin(db)).result, 'monthly_limit');
    await asRole(db, 'service_role');
    await assert.rejects(begin(db), DENIED);
  } finally {
    await db.close();
  }
});
