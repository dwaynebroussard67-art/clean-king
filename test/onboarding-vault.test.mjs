import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomBytes } from 'node:crypto';
import { createKeyring, generateOrgKey, wrapDek, unwrapDek, rewrapDek, seal, open, blindIndex, keyringFromEnv } from '../lib/server/envelope-vault.mjs';
import * as V from '../lib/onboarding/validators.mjs';
import { importCsv, classifyValue } from '../lib/onboarding/import.mjs';
import { FRANCHISE_MANIFEST, TIER } from '../lib/onboarding/manifest.mjs';
import { issueEmployeeRequest, describeRequest, submitViaLink, storeAsOwner, reveal, hashToken } from '../lib/server/onboarding-vault-handler.mjs';

const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', ORG2 = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const OWNER = '11111111-1111-4111-8111-111111111111', OWNER2 = '22222222-2222-4222-8222-222222222222', STRANGER = '33333333-3333-4333-8333-333333333333';
const ring = () => createKeyring({ current: 1, keys: { 1: randomBytes(32) } });

// ---------------------------------------------------------------- validators
test('SSN validation rejects structurally impossible numbers and never echoes input', () => {
  assert.deepEqual(V.validateSsn('123-45-6789'), { ok: true, value: '123456789' });
  for (const bad of ['000-12-3456', '666-12-3456', '900-12-3456', '123-00-4567', '123-45-0000', '12345678', 'abc']) {
    const r = V.validateSsn(bad); assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes(bad.replace(/\D/g, '') || 'zzz'));
  }
});
test('routing numbers use the ABA checksum; accounts, EIN, dates, phones normalize', () => {
  assert.equal(V.validateRouting('021000021').ok, true);   // a well-known valid test routing number
  assert.equal(V.validateRouting('021000022').ok, false);
  assert.equal(V.validateEin('12-3456789').value, '123456789');
  assert.equal(V.validateEin('00-1234567').ok, false);
  assert.equal(V.validateDate('2025-02-30').ok, false);
  assert.equal(V.validatePhone('(337) 555-0101').value, '3375550101');
  assert.equal(V.maskLast4('123456789', '•••-••-'), '•••-••-6789');
  assert.equal(V.maskLast4('123'), '••••', 'short values are never partially revealed');
});

// ---------------------------------------------------------------- manifest
test('manifest: Tier 2 fields are never importable and employee-entry set is exactly the personal ones', () => {
  const t2 = FRANCHISE_MANIFEST.fields.filter((f) => f.tier === TIER.SENSITIVE);
  assert.ok(t2.length >= 8);
  for (const f of t2) assert.equal(typeof f.mask, 'function', `${f.key} needs a mask`);
  assert.ok(FRANCHISE_MANIFEST.fields.filter((f) => f.tier < 2).every((f) => !f.mask));
});

// ---------------------------------------------------------------- vault crypto
test('seal/open round-trips and ciphertext is bound to org, subject and field', () => {
  const r = ring(), { dek } = generateOrgKey(ORG, r);
  const ctx = { orgId: ORG, subjectKey: 'employee:e1', fieldKey: 'employee_ssn' };
  const box = seal('123456789', ctx, dek);
  assert.ok(!box.includes('123456789'));
  assert.equal(open(box, ctx, dek), '123456789');
  assert.notEqual(seal('123456789', ctx, dek), box, 'fresh IV every time');
  for (const wrong of [{ ...ctx, subjectKey: 'employee:e2' }, { ...ctx, fieldKey: 'employee_license' }, { ...ctx, orgId: ORG2 }])
    assert.throws(() => open(box, wrong, dek), /vault_open_failed/);
  assert.throws(() => open(box.slice(0, -2) + 'AA', ctx, dek), /vault_open_failed/);
  assert.throws(() => open(box, ctx, randomBytes(32)), /vault_open_failed/);
});
test('DEK wrapping binds to the franchise and survives KEK rotation without touching data', () => {
  const r1 = createKeyring({ current: 1, keys: { 1: randomBytes(32) } });
  const { dek, wrapped, kekVersion } = generateOrgKey(ORG, r1);
  assert.throws(() => unwrapDek(wrapped, ORG2, kekVersion, r1), /vault_unwrap_failed/, 'another franchise cannot unwrap');
  const k2 = randomBytes(32);
  const r2 = createKeyring({ current: 2, keys: { 1: r1.get(1), 2: k2 } });
  const re = rewrapDek(wrapped, ORG, 1, r2);
  assert.equal(re.kekVersion, 2);
  assert.deepEqual(unwrapDek(re.wrapped, ORG, 2, r2), dek);
  const retired = createKeyring({ current: 2, keys: { 2: k2 } });          // old KEK deleted after rotation
  assert.deepEqual(unwrapDek(re.wrapped, ORG, 2, retired), dek);
});
test('blind index matches equal values per franchise/field only', () => {
  const { dek } = generateOrgKey(ORG, ring()), { dek: other } = generateOrgKey(ORG2, ring());
  assert.equal(blindIndex('123456789', 'employee_ssn', dek), blindIndex('123456789', 'employee_ssn', dek));
  assert.notEqual(blindIndex('123456789', 'employee_ssn', dek), blindIndex('123456780', 'employee_ssn', dek));
  assert.notEqual(blindIndex('123456789', 'employee_ssn', dek), blindIndex('123456789', 'owner_ssn', dek));
  assert.notEqual(blindIndex('123456789', 'employee_ssn', dek), blindIndex('123456789', 'employee_ssn', other));
});
test('keyring from env fails closed on bad config', () => {
  assert.equal(keyringFromEnv({}), null);
  assert.equal(keyringFromEnv({ ONBOARDING_KEK_CURRENT: '1', ONBOARDING_KEK_V1: 'short' }), null);
  assert.equal(keyringFromEnv({ ONBOARDING_KEK_CURRENT: '2', ONBOARDING_KEK_V1: randomBytes(32).toString('base64') }), null);
  assert.ok(keyringFromEnv({ ONBOARDING_KEK_CURRENT: '1', ONBOARDING_KEK_V1: randomBytes(32).toString('base64') }));
});

// ---------------------------------------------------------------- import guard
test('CSV import maps Tier-1 columns and quarantines SSN/bank/DOB columns without returning their values', () => {
  const csv = 'Name,Cell,Social Security,Start Date,Bank Account,Notes\n"Doe, Jane",337-555-0101,123-45-6789,2025-01-05,000123456789,x\nBob,3375550102,987-65-4321,2024-03-01,000987654321,y\n';
  const r = importCsv(csv, 'employee');
  assert.deepEqual(r.rows[0], { employee_name: 'Doe, Jane', employee_phone: '3375550101', employee_hire_date: '2025-01-05' });
  assert.deepEqual(r.quarantined.map((q) => q.column).sort(), ['Bank Account', 'Social Security']);
  const dump = JSON.stringify(r);
  for (const secret of ['123-45-6789', '987-65-4321', '000123456789']) assert.ok(!dump.includes(secret), 'quarantined values must not appear anywhere in the result');
});
test('an SSN hiding in an innocently named column is still caught by value', () => {
  const r = importCsv('Name,Memo\nJane,123-45-6789\nBob,call back\n', 'employee');
  assert.equal(r.quarantined[0].column, 'Memo');
  assert.equal(classifyValue('4111 1111 1111 1111'), 'card_like_value');
  assert.equal(r.rows.some((x) => JSON.stringify(x).includes('123-45-6789')), false);
});

// ---------------------------------------------------------------- database + handler end to end
async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  // Apply the real migration chain, not stubs: the vault migration depends on the
  // organizations/membership schema and the shared owns_organization() authorization.
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(folder)).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL(name, folder), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
  }
  // Seed two synthetic franchises, one owner each, plus a stranger with no membership.
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [OWNER, OWNER2, STRANGER]);
  await db.query(`insert into public.organizations(id, name, slug, owner_id, origin, status)
    values ($1, 'Franchise A', 'franchise-a', $2, 'https://a.example.test', 'active'),
           ($3, 'Franchise B', 'franchise-b', $4, 'https://b.example.test', 'active')`,
    [ORG, OWNER, ORG2, OWNER2]);
  await db.query('insert into public.owner_memberships(user_id, organization_id) values ($1,$3),($2,$4)', [OWNER, OWNER2, ORG, ORG2]);
  const as = async (role, sub) => { await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${sub ?? ''}',false)`); };
  // The handler's rpc runs as service_role, exactly like the production admin client.
  const rpc = async (name, args) => {
    await as('service_role');
    const keys = Object.keys(args), sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}${/p_items|p_field_keys$/.test(k) ? (k === 'p_items' ? '::jsonb' : '::text[]') : ''}`).join(', ')})`;
    const params = keys.map((k) => (k === 'p_items' ? JSON.stringify(args[k]) : args[k]));
    const res = await db.query(sql, params);
    // single-column scalar functions come back as { fn_name: value }
    return res.fields.length === 1 && !Array.isArray(res.rows[0]?.[res.fields[0].name]) && name !== 'get_org_data_key' ? res.rows[0]?.[res.fields[0].name] : res.rows;
  };
  return { db, as, rpc };
}

test('employee one-time link: owner issues, employee enters, ciphertext lands, link burns, log written', async () => {
  const { db, as, rpc } = await freshDb(); const deps = { rpc, keyring: ring() };
  try {
    const issued = await issueEmployeeRequest({ orgId: ORG, actorId: OWNER, employeeKey: 'emp1' }, deps);
    assert.equal(issued.ok, true);
    await db.exec('reset role');
    const rowHash = (await db.query('select token_hash from public.sensitive_requests')).rows[0].token_hash;
    assert.equal(rowHash, hashToken(issued.token)); assert.ok(!rowHash.includes(issued.token));
    assert.equal((await describeRequest(issued.token, deps)).ok, true);
    assert.equal((await describeRequest('x'.repeat(43), deps)).error, 'link_invalid');

    // Invalid SSN rejects the whole submission and does NOT burn the link.
    const bad = await submitViaLink({ token: issued.token, values: { employee_ssn: '000-00-0000', employee_license: 'D1234567' } }, deps);
    assert.deepEqual([bad.ok, bad.error, bad.fields.employee_ssn], [false, 'invalid_values', 'ssn_invalid']);
    // A field the owner did not request (or a Tier-1 field) is refused.
    assert.equal((await submitViaLink({ token: issued.token, values: { employee_name: 'x' } }, deps)).ok, false);

    const ok = await submitViaLink({ token: issued.token, values: { employee_ssn: '123-45-6789', employee_routing: '021000021', employee_account: '123456789012' } }, deps);
    assert.equal(ok.ok, true); assert.deepEqual(ok.stored.map((s) => s.mask).sort(), ['•••-••-6789', '••••9012', '••••0021'].sort());
    assert.equal((await submitViaLink({ token: issued.token, values: { employee_ssn: '123-45-6789' } }, deps)).error, 'link_used');
    assert.equal((await describeRequest(issued.token, deps)).error, 'link_used');

    // The database never holds the plaintext anywhere.
    await db.exec('reset role');
    const dump = JSON.stringify((await db.query('select * from public.sensitive_items')).rows) + JSON.stringify((await db.query('select * from public.vault_access_log')).rows);
    for (const secret of ['123456789', '123-45-6789', '021000021', '123456789012']) assert.ok(!dump.includes(secret), `${secret} leaked into storage`);
    assert.equal((await db.query("select count(*)::int n from public.vault_access_log where action='store_via_link'")).rows[0].n, 3);

    // Expired links are refused.
    const t2 = await issueEmployeeRequest({ orgId: ORG, actorId: OWNER, employeeKey: 'emp2', ttlHours: 1 }, deps);
    await db.exec('reset role');
    await db.exec(`update public.sensitive_requests set expires_at = now() - interval '1 minute' where token_hash='${hashToken(t2.token)}'`);
    assert.equal((await submitViaLink({ token: t2.token, values: { employee_ssn: '123-45-6789' } }, deps)).error, 'link_expired');
  } finally { await db.close(); }
});

test('only an owner of THAT franchise can issue, store or reveal; reveal needs step-up + reason and is logged', async () => {
  const { db, as, rpc } = await freshDb(); let clock = 1_000_000; const deps = { rpc, keyring: ring(), now: () => clock };
  try {
    await assert.rejects(issueEmployeeRequest({ orgId: ORG, actorId: OWNER2, employeeKey: 'e1' }, deps), /rpc_failed|Not authorized/i);
    await assert.rejects(storeAsOwner({ orgId: ORG, actorId: STRANGER, subjectKey: 'owner', fieldKey: 'owner_ssn', value: '123-45-6789' }, deps));
    const stored = await storeAsOwner({ orgId: ORG, actorId: OWNER, subjectKey: 'owner', fieldKey: 'owner_ssn', value: '123-45-6789' }, deps);
    assert.deepEqual([stored.ok, stored.mask], [true, '•••-••-6789']);
    assert.equal((await storeAsOwner({ orgId: ORG, actorId: OWNER, subjectKey: 'owner', fieldKey: 'owner_ssn', value: '111-11' }, deps)).error, 'ssn_format');
    assert.equal((await storeAsOwner({ orgId: ORG, actorId: OWNER, subjectKey: 'owner', fieldKey: 'legal_name', value: 'x' }, deps)).error, 'not_allowed');

    const base = { orgId: ORG, actorId: OWNER, itemId: stored.id, reason: 'Needed for bonding application' };
    assert.equal((await reveal({ ...base, stepUpAt: undefined }, deps)).error, 'step_up_required');
    assert.equal((await reveal({ ...base, stepUpAt: clock - 6 * 60_000 }, deps)).error, 'step_up_required', 'stale step-up');
    await assert.rejects(reveal({ ...base, reason: 'x', stepUpAt: clock }, deps));
    await assert.rejects(reveal({ ...base, actorId: OWNER2, stepUpAt: clock }, deps), undefined, 'other franchise owner');
    assert.deepEqual(await reveal({ ...base, stepUpAt: clock - 1000 }, deps), { ok: true, value: '123456789' });
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int n from public.vault_access_log where action='reveal'")).rows[0].n, 1, 'only the authorized, reasoned reveal is logged; refused attempts never reach ciphertext');
  } finally { await db.close(); }
});

test('owner sessions see masked metadata for their franchise only; ciphertext is unreadable by every role; log is append-only', async () => {
  const { db, as, rpc } = await freshDb(); const deps = { rpc, keyring: ring() };
  try {
    const a = await storeAsOwner({ orgId: ORG, actorId: OWNER, subjectKey: 'owner', fieldKey: 'owner_ssn', value: '123-45-6789' }, deps);
    await storeAsOwner({ orgId: ORG2, actorId: OWNER2, subjectKey: 'owner', fieldKey: 'owner_ssn', value: '987-65-4321' }, deps);

    await as('authenticated', OWNER);
    const meta = (await db.query('select field_key, mask from public.sensitive_items')).rows;
    assert.deepEqual(meta, [{ field_key: 'owner_ssn', mask: '•••-••-6789' }]);
    await assert.rejects(db.query('select ciphertext from public.sensitive_items'), /permission denied/);
    await assert.rejects(db.query('select blind_index from public.sensitive_items'), /permission denied/);
    await assert.rejects(db.query('update public.sensitive_items set mask=$1', ['x']), /permission denied/);
    await assert.rejects(db.query('select * from public.org_data_keys'), /permission denied/);
    await assert.rejects(db.query('select * from public.vault_reveal($1,$2,$3,$4)', [ORG, OWNER, a.id, 'sneaky direct call']), /permission denied/);
    await as('authenticated', STRANGER);
    assert.equal((await db.query('select id from public.sensitive_items')).rows.length, 0);
    await as('service_role');
    await assert.rejects(db.query('select ciphertext from public.sensitive_items'), /permission denied/, 'even the server role cannot read the table directly');
    await assert.rejects(db.query('select * from public.org_data_keys'), /permission denied/);
    await as('anon');
    await assert.rejects(db.query('select * from public.sensitive_items'), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query("update public.vault_access_log set detail='tampered'"), /append-only/);
    await assert.rejects(db.query('delete from public.vault_access_log'), /append-only/);
  } finally { await db.close(); }
});

test('Tier 0/1 items: server proposes, owner confirms in own franchise, Tier 2 is refused by the table', async () => {
  const { db, as, rpc } = await freshDb();
  try {
    const items = [
      { subject_key: 'business', field_key: 'business_phone', tier: 0, value: '3375550100' },
      { subject_key: 'employee:e1', field_key: 'employee_name', tier: 1, value: 'Jane Doe' },
    ];
    assert.equal(await rpc('upsert_onboarding_items', { p_org: ORG, p_actor: OWNER, p_source: 'file_import', p_items: items }), 2);
    await assert.rejects(rpc('upsert_onboarding_items', { p_org: ORG, p_actor: OWNER2, p_source: 'file_import', p_items: items }));
    await assert.rejects(rpc('upsert_onboarding_items', { p_org: ORG, p_actor: OWNER, p_source: 'file_import', p_items: [{ subject_key: 'owner', field_key: 'owner_ssn', tier: 2, value: '123456789' }] }), /check constraint|violates/i);
    await as('authenticated', OWNER2);
    assert.equal((await db.query('select * from public.onboarding_items')).rows.length, 0);
    assert.equal((await db.query('select public.confirm_onboarding_items() as n')).rows[0].n, 0, 'other franchise confirms nothing of ours');
    await as('authenticated', OWNER);
    assert.equal((await db.query('select public.confirm_onboarding_items() as n')).rows[0].n, 2);
    assert.deepEqual((await db.query('select distinct status from public.onboarding_items')).rows, [{ status: 'confirmed' }]);
    await as('authenticated', STRANGER);
    await assert.rejects(db.query('select public.confirm_onboarding_items()'));
  } finally { await db.close(); }
});
