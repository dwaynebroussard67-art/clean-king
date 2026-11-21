import { createHash } from 'node:crypto';
import { parseIntake, toRow } from '../intake.mjs';

const MAX_BODY_BYTES = 16384;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status, error) => reply({ error }, status);

// Enforce the byte limit on the actual stream, not just a potentially missing/forged header.
async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return { error: 'invalid' };
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); return { error: 'large' }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; }
  catch { return { error: 'invalid' }; }
}

// Dependencies are injected so HTTP failure paths can be tested without live services.
export function createIntakeHandler({ getConfig, referralsEnabled, createAdmin, after, processNotifications, organizationByOrigin, fetcher = fetch }) {
  return async function handleIntake(request) {
    const config = getConfig();
    if (!config) return fail(503, 'Intake is not configured.');
    const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (request.headers.get('origin') !== config.origin || type !== 'application/json') return fail(403, 'Request rejected.');
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) return fail(413, 'Request too large.');
    let parsedBody;
    try { parsedBody = await readJson(request); } catch { return fail(400, 'Invalid request.'); }
    if (parsedBody.error === 'large') return fail(413, 'Request too large.');
    if (parsedBody.error) return fail(400, 'Invalid request.');
    const input = parseIntake(parsedBody.data);
    if (!input) return fail(400, 'Please check the form fields.');
    if (input.kind === 'application' && input.data.referralCode && !referralsEnabled()) return fail(503, 'Referral invitations are not available.');

    // Multi-franchise: resolve the organization for this origin so every
    // applicant/lead is scoped to the correct franchise from the start.
    const organization = organizationByOrigin ? await organizationByOrigin(config.origin) : null;
    if (input.kind === 'application' && input.data.referralCode && !organization) {
      return fail(503, 'Intake is not configured.');
    }
    try {
      const verification = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ secret: config.secret, response: input.token }), signal: AbortSignal.timeout(8000),
      });
      if (!verification.ok) return fail(503, 'Verification unavailable. Please try again.');
      const result = await verification.json();
      if (!result.success || result.hostname !== config.hostname || result.action !== input.kind) return fail(400, 'Verification expired. Please try again.');
      const client = createAdmin();
      if (!client) return fail(503, 'Intake is not configured.');
      const table = input.kind === 'application' ? 'applicants' : 'leads';
      const requestHash = createHash('sha256').update(JSON.stringify({ kind: input.kind, formLanguage: input.formLanguage, data: input.data })).digest('hex');
      const row = { ...toRow(input), request_hash: requestHash };
      if (organization) row.organization_id = organization.id;
      let error;
      if (input.kind === 'application' && input.data.referralCode) {
        const codeHash = createHash('sha256').update(input.data.referralCode).digest('hex');
        const rpc = await client.rpc('submit_referred_application', {
          p_row: row, p_code_hash: codeHash,
          p_organization_id: organization ? organization.id : null,
        });
        if (rpc.error) return fail(503, 'Could not save your request. Please try again.');
        if (rpc.data === 'invalid') return fail(422, 'Invitation is invalid, expired or already used.');
        if (rpc.data === 'conflict') return fail(409, 'This submission conflicts with an earlier request. Please reload the form.');
        if (!['inserted', 'duplicate'].includes(rpc.data)) return fail(503, 'Could not save your request. Please try again.');
      } else {
        ({ error } = await client.from(table).insert(row));
      }
      if (error?.code === '23505') {
        const { data: existing, error: lookupError } = await client.from(table).select('request_hash').eq('request_id', input.requestId).maybeSingle();
        if (lookupError || !existing || existing.request_hash !== requestHash) return fail(409, 'This submission conflicts with an earlier request. Please reload the form.');
      } else if (error) return fail(503, 'Could not save your request. Please try again.');
      // The outbox is committed with the application; the external scheduler is required for retries.
      if (input.kind === 'application') {
        try { after(async () => { try { await processNotifications(1); } catch { /* leave job for scheduler */ } }); }
        catch { /* a platform without after() still requires the external scheduler */ }
      }
      return reply({ ok: true });
    } catch { return fail(503, 'Could not save your request. Please try again.'); }
  };
}
