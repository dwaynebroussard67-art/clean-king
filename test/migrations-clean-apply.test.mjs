import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Applies EVERY migration in timestamp order against a fresh embedded Postgres.
// This is the "clean database" gate from the red-team test plan. Migrations are
// single-apply by contract (Supabase records applied migrations); the multi-franchise
// organizations migration is additionally verified to be re-runnable because it was
// designed with IF [NOT] EXISTS guards. PGlite has no pgcrypto, but no migration
// depends on it other than the intake foundation's guarded create-extension line.

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
  return db;
}

async function applyAll(db) {
  const folder = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.length >= 15, 'expected the full migration set');
  for (const file of files) {
    const sql = (await readFile(new URL(file, folder), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  return files;
}

test('all migrations apply cleanly in timestamp order on a fresh database', async () => {
  const db = await freshDb();
  try {
    await applyAll(db);
    // Spot-check the load-bearing objects exist after the full chain.
    for (const fn of ['is_business_owner', 'current_organization_id', 'begin_assistant_run', 'finish_assistant_run', 'submit_referred_application', 'create_employee_invitation', 'start_employee_onboarding', 'claim_application_notification', 'audit_intake_change']) {
      const { rows } = await db.query('select 1 from pg_proc where proname = $1', [fn]);
      assert.ok(rows.length >= 1, `expected function ${fn} to exist`);
    }
    // Exactly one zero-argument is_business_owner(): a second overload made every
    // emergency-stop check ambiguous (or bypassed) — never again.
    const { rows } = await db.query("select proname, pronargs from pg_proc where proname = 'is_business_owner'");
    assert.deepEqual(rows.map((r) => r.pronargs).sort(), [0]);
  } finally {
    await db.close();
  }
});

test('the organizations migration is re-runnable', async () => {
  const db = await freshDb();
  try {
    await applyAll(db);
    const sql = (await readFile(new URL('../supabase/migrations/20261121030000_organizations_multi_franchise.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
    await db.exec(sql);
  } finally {
    await db.close();
  }
});

test('every migration after the organizations one applies after a double organizations run', async () => {
  // Guards inside the file must not leave the schema in a state where the
  // remaining migrations (onboarding, notifications, training) break on re-apply order.
  const db = await freshDb();
  try {
    const folder = new URL('../supabase/migrations/', import.meta.url);
    const files = (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = (await readFile(new URL(file, folder), 'utf8')).replace('create extension if not exists pgcrypto;', '');
      await db.exec(sql);
      if (file === '20261121030000_organizations_multi_franchise.sql') await db.exec(sql);
    }
  } finally {
    await db.close();
  }
});
