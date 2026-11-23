import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { keyringFromEnv } from '../../../../../lib/server/envelope-vault.mjs';
import { revealSensitiveItem } from '../../../../../lib/server/onboarding-sensitive.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  return createClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try { items.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* */ }
      },
    },
  });
}

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

async function getTenantId(session, user) {
  if (!session || !user) return null;
  const { data } = await session
    .from('owner_memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .limit(1);
  if (data?.length > 0) return data[0].organization_id;
  return null;
}

const rpc = adminRpc();
const keyring = keyringFromEnv();

export async function POST(request) {
  const session = await sessionClient();
  if (!session) return Response.json({ error: 'sign_in' }, { status: 401 });

  let user;
  try {
    const { data, error } = await session.auth.getUser();
    user = data?.user;
    if (error || !user?.id) return Response.json({ error: 'sign_in' }, { status: 401 });
  } catch { return Response.json({ error: 'sign_in' }, { status: 401 }); }

  const tenantId = await getTenantId(session, user);
  if (!tenantId) return Response.json({ error: 'not_authorized' }, { status: 403 });

  if (!rpc || !keyring) return Response.json({ error: 'not_configured' }, { status: 503 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }

  const { itemId, reason, stepUpAt } = body;
  if (!itemId || !reason || typeof stepUpAt !== 'number') {
    return Response.json({ error: 'missing_step_up' }, { status: 400 });
  }

  try {
    const result = await revealSensitiveItem({
      rpc, keyring, orgId: tenantId, actorId: user.id,
      itemId, reason, stepUpAt, now: Date.now,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 403 });
    // Return the value but never log it
    return Response.json({ ok: true, value: result.value }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: err.message || 'reveal_failed' }, { status: 500 });
  }
}