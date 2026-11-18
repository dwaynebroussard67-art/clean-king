import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_SETTINGS } from '../lib/assistant-settings-schema.mjs';
import { decryptSecret, encryptSecret, lastFour } from '../lib/server/secret-box.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const SECOND_OWNER = '33333333-3333-4333-8333-333333333333';
const KEY = Buffer.alloc(32, 15).toString('base64');
const denied = { code: '42501' };
const saveRpc = 'select * from public.save_assistant_settings(p_settings => $1::text::jsonb, p_expected_version => $2)';
const setRpc = 'select public.set_assistant_secret(p_name => $1, p_ciphertext => $2, p_last4 => $3) as ok';
const getRpc = 'select * from public.get_assistant_secret(p_name => $1)';
const clearRpc = 'select public.clear_assistant_secret(p_name => $1) as ok';
const beginRpc = 'select * from public.begin_assistant_run(p_per_minute => $1, p_per_month => $2)';
const finishRpc = 'select public.finish_assistant_run(p_run_id => $1, p_success => $2) as ok';

async function initialize(db) {
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
  for (const name of files) {
    const migration = await readFile(new URL(name, migrations), 'utf8');
    // PGlite includes gen_random_uuid() without pgcrypto.
    await db.exec(migration.replace('create extension if not exists pgcrypto;', ''));
  }
  await db.query('insert into auth.users (id) values ($1), ($2), ($3)', [OWNER, STRANGER, SECOND_OWNER]);
  await db.query('insert into public.owner_memberships (user_id) values ($1), ($2)', [OWNER, SECOND_OWNER]);
}

async function asRole(db, role, uid = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec(`set role ${role}`);
}

async function one(db, sql, params) {
  return (await db.query(sql, params)).rows[0];
}

function save(db, settings, version) {
  return one(db, saveRpc, [JSON.stringify(settings), version]);
}

function begin(db, ...limits) {
  return limits.length ? one(db, beginRpc, limits) : one(db, 'select * from public.begin_assistant_run()');
}

async function seedRuns(db, count) {
  await db.exec('reset role');
  await db.query(`insert into public.assistant_runs (owner_id)
    select $1::uuid from generate_series(1, $2::int)`, [OWNER, count]);
}

test('assistant migration protects settings, secret boxes, audit metadata and workspace quotas', async (t) => {
  const db = new PGlite();
  const testSecret = 'synthetic-provider-key-8ZQK';
  const boxed = encryptSecret(testSecret, KEY);
  const last4 = lastFour(testSecret);
  try {
    await initialize(db);

    await t.test('owners save settings with optimistic versions; malformed RPC writes are rejected', async () => {
      await asRole(db, 'authenticated', OWNER);
      assert.deepEqual((await db.query('select * from public.get_assistant_settings()')).rows, []);
      assert.deepEqual(await save(db, DEFAULT_SETTINGS, 1), { result: 'conflict', version: 0 });
      assert.deepEqual(await save(db, DEFAULT_SETTINGS, 0), { result: 'ok', version: 1 });
      assert.deepEqual(await one(db, 'select * from public.get_assistant_settings()'), {
        settings: DEFAULT_SETTINGS, version: 1,
      });

      const { enabled, ...missingRequired } = DEFAULT_SETTINGS;
      for (const settings of [
        null, true, [], missingRequired,
        { ...DEFAULT_SETTINGS, version: '1' }, { ...DEFAULT_SETTINGS, version: 2 },
        { ...DEFAULT_SETTINGS, enabled: 'true' }, { ...DEFAULT_SETTINGS, extra: true },
        { ...DEFAULT_SETTINGS, voice: [] },
        { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, perMinute: 0 } },
        { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, perMinute: 1.5 } },
        { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, perMonth: '100' } },
        { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, perMonth: 1001 } },
        { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, maxOutputTokens: 801 } },
        { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, temperature: 1.1 } },
        { ...DEFAULT_SETTINGS, provider: { ...DEFAULT_SETTINGS.provider, customBaseUrl: 'http://example.test' } },
        { ...DEFAULT_SETTINGS, provider: { ...DEFAULT_SETTINGS.provider, extra: null } },
      ]) {
        assert.deepEqual(await save(db, settings, 1), { result: 'invalid', version: 1 });
      }
      const changed = { ...DEFAULT_SETTINGS, enabled: !enabled, persona: { ...DEFAULT_SETTINGS.persona, name: 'Brilló' } };
      await asRole(db, 'authenticated', SECOND_OWNER);
      assert.deepEqual(await save(db, changed, 0), { result: 'conflict', version: 1 });
      assert.deepEqual(await save(db, changed, 1), { result: 'ok', version: 2 });
      assert.deepEqual(await one(db, 'select * from public.get_assistant_settings()'), {
        settings: changed, version: 2,
      });
      await assert.rejects(db.query('update public.assistant_settings set version = 10'), denied);
    });

    await t.test('owners can set, get and clear secret boxes without auditing secret material', async () => {
      await asRole(db, 'authenticated', OWNER);
      assert.deepEqual((await db.query(getRpc, ['anthropic'])).rows, []);
      assert.equal((await one(db, setRpc, ['invalid', boxed, last4])).ok, false);
      assert.equal((await one(db, setRpc, ['anthropic', testSecret, last4])).ok, false);
      assert.equal((await one(db, setRpc, ['anthropic', boxed, testSecret])).ok, false);
      assert.equal((await one(db, setRpc, ['anthropic', boxed, last4])).ok, true);
      const stored = await one(db, getRpc, ['anthropic']);
      assert.deepEqual(stored, { ciphertext: boxed, last4 });
      assert.equal(decryptSecret(stored.ciphertext, KEY), testSecret);
      const customBox = encryptSecret('short', KEY);
      assert.equal((await one(db, setRpc, ['custom', customBox, null])).ok, true);
      assert.equal((await one(db, clearRpc, ['invalid'])).ok, false);
      assert.equal((await one(db, clearRpc, ['anthropic'])).ok, true);
      assert.equal((await one(db, clearRpc, ['anthropic'])).ok, true);
      assert.deepEqual((await db.query(getRpc, ['anthropic'])).rows, []);
      assert.deepEqual(await one(db, getRpc, ['custom']), { ciphertext: customBox, last4: null });
      await assert.rejects(db.query('delete from public.assistant_secrets'), denied);
      await assert.rejects(db.query('delete from public.assistant_settings_audit'), denied);

      const { rows } = await db.query('select * from public.assistant_settings_audit order by id');
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ['action', 'actor_id', 'changed_keys', 'created_at', 'id', 'secret_name']);
        assert.ok(row.created_at);
      }
      assert.deepEqual(rows.map((row) => [row.actor_id, row.action, row.changed_keys, row.secret_name]), [
        [OWNER, 'settings_saved', ['capabilities', 'enabled', 'limits', 'persona', 'provider', 'version', 'voice'], null],
        [SECOND_OWNER, 'settings_saved', ['enabled', 'persona'], null],
        [OWNER, 'secret_set', [], 'anthropic'],
        [OWNER, 'secret_set', [], 'custom'],
        [OWNER, 'secret_cleared', [], 'anthropic'],
      ]);
      const audit = JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
      for (const value of [testSecret, boxed, last4, customBox, 'Sparkle', 'Brilló']) {
        assert.equal(audit.includes(value), false);
      }
    });

    await t.test('anon, missing sessions, non-owners and the service role cannot use the RPCs', async () => {
      const calls = [
        ['select * from public.get_assistant_settings()'],
        [saveRpc, [JSON.stringify(DEFAULT_SETTINGS), 2]],
        [setRpc, ['anthropic', boxed, last4]], [getRpc, ['anthropic']], [clearRpc, ['custom']],
        [beginRpc, [3, 100]], [finishRpc, [OWNER, false]],
      ];
      for (const [role, uid] of [
        ['anon', OWNER], ['authenticated', ''], ['authenticated', STRANGER], ['service_role', OWNER],
      ]) {
        await asRole(db, role, uid);
        for (const [sql, params] of calls) await assert.rejects(db.query(sql, params), denied);
        await assert.rejects(db.query('select * from public.assistant_settings'), denied);
        await assert.rejects(db.query('select * from public.assistant_secrets'), denied);
        if (role === 'authenticated') {
          assert.deepEqual((await db.query('select * from public.assistant_settings_audit')).rows, []);
          assert.deepEqual((await db.query('select * from public.assistant_runs')).rows, []);
        } else {
          await assert.rejects(db.query('select * from public.assistant_settings_audit'), denied);
        }
      }
      await asRole(db, 'authenticated', OWNER);
      assert.deepEqual(await one(db, `select to_regprocedure('public.begin_assistant_run()') is null as old_gone`), {
        old_gone: true,
      });
      await assert.rejects(db.query('select * from public.assistant_settings'), denied);
      await assert.rejects(db.query('select * from public.assistant_secrets'), denied);
    });

    await t.test('default budgets are 3/minute and 100/month across owners and run statuses', async () => {
      await asRole(db, 'authenticated', OWNER);
      const first = await begin(db);
      assert.ok(first.run_id);
      assert.equal(first.result, 'ok');
      await asRole(db, 'authenticated', SECOND_OWNER);
      assert.equal((await one(db, finishRpc, [first.run_id, true])).ok, false);
      assert.equal((await begin(db)).result, 'ok');
      await asRole(db, 'authenticated', OWNER);
      assert.equal((await one(db, finishRpc, [first.run_id, true])).ok, true);
      assert.equal((await one(db, finishRpc, [first.run_id, true])).ok, false);
      const third = await begin(db);
      assert.equal(third.result, 'ok');
      assert.equal((await one(db, finishRpc, [third.run_id, false])).ok, true);
      assert.deepEqual(await begin(db), { run_id: null, result: 'rate_limit' });
      await assert.rejects(db.query('delete from public.assistant_runs'), denied);
      await seedRuns(db, 97);
      await asRole(db, 'authenticated', OWNER);
      assert.deepEqual(await begin(db), { run_id: null, result: 'monthly_limit' });
    });

    await t.test('custom limits use both windows and clamp to 1–10 and 1–1000', async () => {
      await db.exec('reset role; truncate public.assistant_runs');
      await db.query(`insert into public.assistant_runs (owner_id, created_at)
        values ($1, now() - interval '2 months')`, [OWNER]);
      await asRole(db, 'authenticated', OWNER);
      assert.equal((await begin(db, -10, 0)).result, 'ok');
      assert.equal((await begin(db, 10, 0)).result, 'monthly_limit');
      assert.equal((await begin(db, -10, 5)).result, 'rate_limit');
      await asRole(db, 'authenticated', SECOND_OWNER);
      assert.equal((await begin(db, 2, 5)).result, 'ok');
      assert.equal((await begin(db, 2, 5)).result, 'rate_limit');
      assert.equal((await begin(db, 5, 2)).result, 'monthly_limit');

      await seedRuns(db, 7);
      await asRole(db, 'authenticated', OWNER);
      assert.equal((await begin(db, 100, 5000)).result, 'ok');
      assert.equal((await begin(db, 100, 5000)).result, 'rate_limit');
      await seedRuns(db, 990);
      await asRole(db, 'authenticated', OWNER);
      assert.equal((await begin(db, 100, 5000)).result, 'monthly_limit');
    });
  } finally {
    await db.close();
  }
});
