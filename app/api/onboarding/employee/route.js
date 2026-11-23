/**
 * Public employee onboarding endpoint (WP-G2).
 * Accessed via a one-time token issued by the owner.
 * GET /api/onboarding/employee?token=... — describe requested fields (metadata only)
 * POST /api/onboarding/employee — submit tier-2 values via token
 * No authentication required; the token is the authorization.
 */

import { createClient } from '@supabase/supabase-js';
import { describeEmployeeLink, submitEmployeeLink } from '../../../../lib/server/onboarding-employee-link.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function adminRpc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (name, args) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`rpc_failed:${name}`);
    return data;
  };
}

const rpc = adminRpc();

function getToken(request) {
  if (request.method === 'GET') {
    const { searchParams } = new URL(request.url);
    return searchParams.get('token');
  }
  return null;
}

export async function GET(request) {
  if (!rpc) return Response.json({ error: 'not_configured' }, { status: 503 });

  const token = getToken(request);
  if (!token || typeof token !== 'string') {
    return Response.json({ error: 'missing_token' }, { status: 400 });
  }

  try {
    const result = await describeEmployeeLink({ rpc, token });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true, fields: result.fields }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: err.message || 'describe_failed' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!rpc) return Response.json({ error: 'not_configured' }, { status: 503 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }

  const { token, values } = body;
  if (!token || typeof token !== 'string' || !values || typeof values !== 'object') {
    return Response.json({ error: 'missing_token_or_values' }, { status: 400 });
  }

  try {
    const result = await submitEmployeeLink({ rpc, token, values });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true, stored: result.stored }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: err.message || 'submit_failed' }, { status: 500 });
  }
}