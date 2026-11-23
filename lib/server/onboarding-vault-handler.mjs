// Server-side orchestration for Tier-2 data. Framework-free so it is testable without Next or Supabase:
// `rpc(name, args)` is injected (in production it wraps adminClient().rpc, see supabaseRpc below).
// The plaintext exists only inside these functions' stack frames: it is validated, sealed, and dropped.
import { createHash, randomBytes } from 'node:crypto';
import { checkValue, fieldDef, employeeEntryFields, TIER } from '../onboarding/manifest.mjs';
import { generateOrgKey, unwrapDek, seal, open, blindIndex } from './envelope-vault.mjs';

const REVEAL_STEP_UP_MS = 5 * 60 * 1000;
export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
const rows = (r) => (Array.isArray(r) ? r : r ? [r] : []);

/** Production adapter: rpc('name', args) -> data, throwing on error without echoing arguments. */
export function supabaseRpc(admin) {
  return async (name, args) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`rpc_failed:${name}`);
    return data;
  };
}

async function orgDek(orgId, { rpc, keyring }) {
  let row = rows(await rpc('get_org_data_key', { p_org: orgId }))[0];
  if (!row) {
    const fresh = generateOrgKey(orgId, keyring);
    // Race-safe: if two requests create a key at once, the database keeps the first and we re-read it.
    row = rows(await rpc('ensure_org_data_key', { p_org: orgId, p_wrapped: fresh.wrapped, p_kek_version: fresh.kekVersion }))[0];
  }
  return { dek: unwrapDek(row.wrapped_dek, orgId, row.kek_version, keyring), version: row.version };
}

function sealValues(values, allowedKeys, orgId, subjectKey, { dek, version }) {
  const out = [], errors = {};
  for (const [fieldKey, raw] of Object.entries(values ?? {})) {
    const def = fieldDef(fieldKey);
    if (!def || def.tier !== TIER.SENSITIVE || !allowedKeys.includes(fieldKey)) { errors[fieldKey] = 'not_allowed'; continue; }
    const checked = checkValue(fieldKey, raw);
    if (!checked.ok) { errors[fieldKey] = checked.error; continue; }
    out.push({
      field_key: fieldKey,
      ciphertext: seal(checked.value, { orgId, subjectKey, fieldKey }, dek, version),
      blind_index: def.blindIndex ? blindIndex(checked.value, fieldKey, dek) : null,
      mask: def.mask(checked.value),
      key_version: version,
    });
  }
  return { items: out, errors };
}

/** Owner asks for an employee to enter their own secrets. Returns the one-time token ONCE; only its hash is stored. */
export async function issueEmployeeRequest({ orgId, actorId, employeeKey, fieldKeys, ttlHours = 72 }, { rpc }) {
  const allowed = employeeEntryFields();
  const wanted = (fieldKeys?.length ? fieldKeys : allowed);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(employeeKey ?? '') || wanted.some((k) => !allowed.includes(k))) return { ok: false, error: 'bad_request' };
  const token = randomBytes(32).toString('base64url');
  const expiresAt = await rpc('issue_sensitive_request', {
    p_org: orgId, p_actor: actorId, p_subject_key: `employee:${employeeKey}`, p_field_keys: wanted,
    p_token_hash: hashToken(token), p_ttl_hours: ttlHours,
  });
  return { ok: true, token, expiresAt, fieldKeys: wanted };
}

/** What the employee's page needs to render the form (field list only; no org or personal info). */
export async function describeRequest(token, deps) {
  const d = await describeRequestFull(token, deps);
  return d.ok ? { ok: true, fields: d.fieldKeys.map((k) => ({ key: k, label: fieldDef(k)?.label })) } : d;
}

/** Employee submits via one-time link. All-or-nothing; any invalid field rejects the whole submission. */
export async function submitViaLink({ token, values }, deps) {
  const desc = await describeRequestFull(token, deps);
  if (!desc.ok) return desc;
  const sealed = sealValues(values, desc.fieldKeys, desc.orgId, desc.subjectKey, await orgDek(desc.orgId, deps));
  if (Object.keys(sealed.errors).length || !sealed.items.length) return { ok: false, error: 'invalid_values', fields: sealed.errors };
  const result = await deps.rpc('submit_sensitive_items', { p_token_hash: hashToken(token), p_items: sealed.items });
  return result === 'ok' ? { ok: true, stored: sealed.items.map((i) => ({ field: i.field_key, mask: i.mask })) }
    : { ok: false, error: result === 'expired' ? 'link_expired' : result === 'used' ? 'link_used' : 'link_invalid' };
}
async function describeRequestFull(token, { rpc }) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 64) return { ok: false, error: 'link_invalid' };
  const r = rows(await rpc('peek_sensitive_request', { p_token_hash: hashToken(token) }))[0];
  if (!r) return { ok: false, error: 'link_invalid' };
  if (r.state !== 'open') return { ok: false, error: r.state === 'expired' ? 'link_expired' : 'link_used' };
  return { ok: true, orgId: r.organization_id, subjectKey: r.subject_key, fieldKeys: r.field_keys };
}

/** Owner types their own secret on their authenticated session. */
export async function storeAsOwner({ orgId, actorId, subjectKey, fieldKey, value }, deps) {
  const def = fieldDef(fieldKey);
  if (!def || def.tier !== TIER.SENSITIVE) return { ok: false, error: 'not_allowed' };
  const sealed = sealValues({ [fieldKey]: value }, [fieldKey], orgId, subjectKey, await orgDek(orgId, deps));
  if (sealed.errors[fieldKey]) return { ok: false, error: sealed.errors[fieldKey] };
  const [it] = sealed.items;
  const id = await deps.rpc('store_sensitive_item', {
    p_org: orgId, p_actor: actorId, p_subject_key: subjectKey, p_field_key: fieldKey,
    p_ciphertext: it.ciphertext, p_blind: it.blind_index, p_mask: it.mask, p_key_version: it.key_version,
  });
  return { ok: true, id, mask: it.mask };
}

/** Decrypt for a human. Requires a fresh step-up (passkey/TOTP) and a written reason; the database logs it. */
export async function reveal({ orgId, actorId, itemId, reason, stepUpAt }, deps) {
  const now = (deps.now ?? Date.now)();
  if (!(typeof stepUpAt === 'number') || now - stepUpAt > REVEAL_STEP_UP_MS || stepUpAt > now + 5000) return { ok: false, error: 'step_up_required' };
  const r = rows(await deps.rpc('vault_reveal', { p_org: orgId, p_actor: actorId, p_item: itemId, p_reason: reason }))[0];
  if (!r) return { ok: false, error: 'not_found' };
  const { dek } = await orgDek(orgId, deps);
  return { ok: true, value: open(r.ciphertext, { orgId, subjectKey: r.subject_key, fieldKey: r.field_key }, dek) };
}
