import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { parseIntake, toRow } from '../../../lib/intake.mjs';
import { adminClient, intakeConfig } from '../../../lib/server/supabase';

export const runtime = 'nodejs';
const fail = (status, error) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request) {
  const config = intakeConfig();
  if (!config) return fail(503, 'Intake is not configured.');
  if (request.headers.get('origin') !== config.origin || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(403, 'Request rejected.');
  if (Number(request.headers.get('content-length') || 0) > 16384) return fail(413, 'Request too large.');
  let raw;
  try {
    // Read incrementally to enforce the limit even when Content-Length is missing or false.
    const reader = request.body?.getReader();
    if (!reader) return fail(400, 'Invalid request.');
    let size = 0, chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return fail(413, 'Request too large.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return fail(400, 'Invalid request.'); }
  const input = parseIntake(raw);
  if (!input) return fail(400, 'Please check the form fields.');
  try {
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ secret: config.secret, response: input.token }), signal: AbortSignal.timeout(8000),
    });
    if (!verification.ok) return fail(503, 'Verification unavailable. Please try again.');
    const result = await verification.json();
    if (!result.success || result.hostname !== config.hostname || result.action !== input.kind) return fail(400, 'Verification expired. Please try again.');
    const client = adminClient();
    if (!client) return fail(503, 'Intake is not configured.');
    const table = input.kind === 'application' ? 'applicants' : 'leads';
    const requestHash = createHash('sha256').update(JSON.stringify({ kind: input.kind, formLanguage: input.formLanguage, data: input.data })).digest('hex');
    const { error } = await client.from(table).insert({ ...toRow(input), request_hash: requestHash });
    if (error?.code === '23505') {
      // A retry is successful only if the stored submission has the same content.
      const { data: existing, error: lookupError } = await client.from(table).select('request_hash').eq('request_id', input.requestId).maybeSingle();
      if (lookupError || !existing || existing.request_hash !== requestHash) return fail(409, 'This submission conflicts with an earlier request. Please reload the form.');
    } else if (error) return fail(503, 'Could not save your request. Please try again.');
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return fail(503, 'Could not save your request. Please try again.'); }
}
