import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const DEFAULTS = {
  version: 1,
  enabled: false,
  persona: { name: 'Assistant', ownerName: 'Owner', tone: 'friendly', emoji: 'light', length: 'short' },
  voice: { speakReplies: false, rate: 1, pitch: 1, voiceName: null },
  capabilities: { counts: true, emailHealth: true },
  provider: { active: 'anthropic', anthropicModel: 'claude-sonnet-5-5', customBaseUrl: '', customModel: '', fallbackToCustom: false },
  limits: { perMinute: 3, perMonth: 100, maxOutputTokens: 400, temperature: 0.4 },
};

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  const foundation = (await readFile(new URL('../supabase/migrations/20261117000000_intake_foundation.sql', import.meta.url), 'utf8'))
    .replace('create extension if not exists pgcrypto;', '');
  await db.exec(foundation);
  await db.exec(await readFile(new URL('../supabase/migrations/20261117020000_assistant_usage.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261118000000_assistant_settings.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${OWNER}'), ('${STRANGER}');
    insert into public.owner_memberships(user_id) values ('${OWNER}');`);
  return db;
}

test('assistant settings and secret RPCs are server-only; owner settings save is optimistic', async () => {
  const db = await setup();
  try {
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.assistant_settings'));
    await assert.rejects(db.query('select * from public.get_assistant_settings($1)', [OWNER]));
    await db.exec('reset role; set role authenticated');
    await db.exec(`select set_config('request.jwt.claim.sub','${STRANGER}',false)`);
    await assert.rejects(db.query('select * from public.assistant_settings'));
    await assert.rejects(db.query('select * from public.get_assistant_secret($1,$2)', [OWNER, 'anthropic']));
    await assert.rejects(db.query('select * from public.set_assistant_secret($1,$2,$3,$4)', [OWNER, 'anthropic', 'v1:a:b:c', null]));

    await db.exec('reset role; set role service_role');
    const saved = await db.query('select * from public.save_assistant_settings($1,$2::jsonb,0)', [OWNER, JSON.stringify(DEFAULTS)]);
    assert.deepEqual(saved.rows[0], { result: 'ok', version: 1 });
    const conflict = await db.query('select * from public.save_assistant_settings($1,$2::jsonb,0)', [OWNER, JSON.stringify(DEFAULTS)]);
    assert.deepEqual(conflict.rows[0], { result: 'conflict', version: 1 });
    const invalid = structuredClone(DEFAULTS);
    invalid.limits.perMinute = 0;
    assert.equal((await db.query('select * from public.save_assistant_settings($1,$2::jsonb,1)', [OWNER, JSON.stringify(invalid)])).rows[0].result, 'invalid');

    const envelope = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:YWJjZGVmZ2g=';
    assert.equal((await db.query('select public.set_assistant_secret($1,$2,$3,$4) as ok', [OWNER, 'anthropic', envelope, '5678'])).rows[0].ok, true);
    const fetched = await db.query('select * from public.get_assistant_secret($1,$2)', [OWNER, 'anthropic']);
    assert.equal(fetched.rows[0].ciphertext, envelope);
    assert.equal(fetched.rows[0].last4, '5678');
    const audit = await db.query('select action, changed_keys, secret_name from public.assistant_settings_audit order by id');
    assert.equal(audit.rows.length, 2);
    assert.deepEqual(audit.rows[1], { action: 'secret_set', changed_keys: [], secret_name: 'anthropic' });
    assert.doesNotMatch(JSON.stringify(audit.rows), /YWJjZGVmZ2g|5678/);
    assert.equal((await db.query('select public.clear_assistant_secret($1,$2) as ok', [OWNER, 'anthropic'])).rows[0].ok, true);
  } finally {
    await db.close();
  }
});

test('assistant quota remains owner-only and the two-argument function defaults to 3/minute and 100/month', async () => {
  const db = await setup();
  try {
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.begin_assistant_run()'));
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${STRANGER}',false);`);
    await assert.rejects(db.query('select * from public.begin_assistant_run()'));
    assert.equal((await db.query('select count(*)::int as n from public.assistant_runs')).rows[0].n, 0);
    await db.exec(`select set_config('request.jwt.claim.sub','${OWNER}',false)`);
    const first = (await db.query('select * from public.begin_assistant_run()')).rows[0];
    assert.equal(first.result, 'ok');
    assert.equal((await db.query(`select public.finish_assistant_run('${first.run_id}',true) as ok`)).rows[0].ok, true);
    await db.query('select * from public.begin_assistant_run()');
    await db.query('select * from public.begin_assistant_run()');
    assert.equal((await db.query('select * from public.begin_assistant_run()')).rows[0].result, 'rate_limit');
    await assert.rejects(db.query('delete from public.assistant_runs'));

    await db.exec(`reset role; update public.assistant_runs set created_at=now()-interval '2 minutes';
      insert into public.assistant_runs(owner_id,created_at)
      select '${OWNER}', now()-interval '2 minutes' from generate_series(1,97);
      set role authenticated; select set_config('request.jwt.claim.sub','${OWNER}',false);`);
    assert.equal((await db.query('select * from public.begin_assistant_run()')).rows[0].result, 'monthly_limit');
  } finally {
    await db.close();
  }
});
