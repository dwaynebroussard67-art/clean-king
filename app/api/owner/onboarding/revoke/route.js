import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { deleteSensitiveItem } from '../../../../../lib/server/onboarding-sensitive.mjs';

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

export async function DELETE(request) {
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

  if (!rpc) return Response.json({ error: 'not_configured' }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('id');
  const reason = searchParams.get('reason') || 'owner_revocation';
  if (!itemId) return Response.json({ error: 'missing_id' }, { status: 400 });

  try {
    const ok = await deleteSensitiveItem({ rpc, orgId: tenantId, actorId: user.id, itemId, reason });
    return Response.json({ ok: !!ok }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: err.message || 'revoke_failed' }, { status: 500 });
  }
}