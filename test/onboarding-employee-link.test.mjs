import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createKeyring, generateOrgKey } from '../lib/server/envelope-vault.mjs';
import { issueEmployeeLink, describeEmployeeLink, submitEmployeeLink } from '../lib/server/onboarding-employee-link.mjs';

const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const VALID_TOKEN = 'a'.repeat(48); // 48 chars, within 40-64 range

async function buildEmployeeRpc(keyring) {
  const { wrapped: wrappedDek, kekVersion: dekVersion } = generateOrgKey(ORG, keyring);
  const rpcCalls = [];
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'issue_sensitive_request') return { expires_at: '2026-12-01T00:00:00Z' };
    if (name === 'peek_sensitive_request') return [{ state: 'open', organization_id: ORG, subject_key: 'employee:emp-1', field_keys: ['employee_ssn'] }];
    if (name === 'get_org_data_key') return [{ wrapped_dek: wrappedDek, kek_version: dekVersion, version: 1 }];
    if (name === 'submit_sensitive_items') return 'ok';
    return null;
  };
  return { rpc, rpcCalls };
}

test('issueEmployeeLink calls issue_sensitive_request RPC and returns token', async () => {
  const keyring = createKeyring({ current: 1, keys: { 1: randomBytes(32) } });
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'issue_sensitive_request') return { expires_at: '2026-12-01T00:00:00Z' };
    return null;
  };

  const result = await issueEmployeeLink({ rpc, orgId: ORG, actorId: ACTOR, employeeKey: 'emp-1', fieldKeys: ['employee_ssn', 'employee_license'] });

  assert.equal(result.ok, true);
  assert.ok(typeof result.token === 'string' && result.token.length > 0);
  assert.deepEqual(result.fieldKeys, ['employee_ssn', 'employee_license']);
  assert.equal(calls[0].name, 'issue_sensitive_request');
  assert.equal(calls[0].args.p_org, ORG);
  assert.equal(calls[0].args.p_actor, ACTOR);
  assert.equal(calls[0].args.p_subject_key, 'employee:emp-1');
  // Token hash is stored, never the raw token
  assert.ok(!calls[0].args.p_token_hash.includes(result.token));
});

test('describeEmployeeLink returns field metadata only', async () => {
  const keyring = createKeyring({ current: 1, keys: { 1: randomBytes(32) } });
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'peek_sensitive_request') return [{ state: 'open', organization_id: ORG, subject_key: 'employee:emp-1', field_keys: ['employee_ssn', 'employee_license'] }];
    return null;
  };

  const result = await describeEmployeeLink({ rpc, token: VALID_TOKEN });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, [
    { key: 'employee_ssn', label: { en: 'Employee SSN', es: 'SSN del empleado' } },
    { key: 'employee_license', label: { en: "Employee driver license / ID", es: "Licencia/ID del empleado" } },
  ]);
});

test('describeEmployeeLink rejects invalid token', async () => {
  const rpc = async () => null;
  const result = await describeEmployeeLink({ rpc, token: 'short' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'link_invalid');
});

test('submitEmployeeLink calls submit_sensitive_items RPC with sealed items', async () => {
  const keyring = createKeyring({ current: 1, keys: { 1: randomBytes(32) } });
  const { rpc, rpcCalls } = await buildEmployeeRpc(keyring);

  const result = await submitEmployeeLink({ rpc, keyring, token: VALID_TOKEN, values: { employee_ssn: '123-45-6789' } });
  assert.equal(result.ok, true);
  const submitCall = rpcCalls.find((c) => c.name === 'submit_sensitive_items');
  assert.ok(submitCall);
  // Items are sealed (ciphertext), plaintext not in RPC args
  assert.ok(!JSON.stringify(submitCall.args).includes('123-45-6789'));
});

test('submitEmployeeLink handles expired link', async () => {
  const keyring = createKeyring({ current: 1, keys: { 1: randomBytes(32) } });
  const rpc = async (name, args) => {
    if (name === 'peek_sensitive_request') return [{ state: 'expired', organization_id: ORG, subject_key: 'employee:emp-1', field_keys: [] }];
    return null;
  };

  const result = await submitEmployeeLink({ rpc, token: VALID_TOKEN, values: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'link_expired');
});