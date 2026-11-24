import { NextResponse } from 'next/server';
import { sessionClient, adminClient } from '../../../../../lib/server/supabase.js';
import { executeBubblesAction, BUBBLES_ACTIONS } from '../../../../../lib/server/bubbles-actions.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveOwnerContext() {
  const session = await sessionClient();
  if (!session) return { error: 'not_configured', status: 503 };
  const { data: { user }, error: userError } = await session.auth.getUser();
  if (userError || !user) return { error: 'sign_in', status: 401 };

  const { data: memberships } = await session
    .from('owner_memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('active', true)
    .limit(1);

  const organizationId = memberships?.[0]?.organization_id ?? null;
  if (!organizationId) return { error: 'not_authorized', status: 403 };

  return { session, user, organizationId };
}

export async function GET(request) {
  const ctx = await resolveOwnerContext();
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'get_briefing';
  if (!BUBBLES_ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  }

  const result = await executeBubblesAction({
    session: ctx.session,
    user: ctx.user,
    organizationId: ctx.organizationId,
    action,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function POST(request) {
  const ctx = await resolveOwnerContext();
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { action, payload } = body ?? {};
  if (!BUBBLES_ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  }

  const result = await executeBubblesAction({
    session: ctx.session,
    user: ctx.user,
    organizationId: ctx.organizationId,
    action,
    payload: payload ?? {},
  });

  // Best-effort audit log for executed actions
  const admin = adminClient();
  if (admin && result.ok && action !== 'get_briefing' && !action.startsWith('list_')) {
    await admin.from('assistant_action_audit').insert({
      tenant_id: ctx.organizationId,
      action_type: action,
      proposal: payload ?? {},
      decision: 'approved',
      result: result.data ?? {},
      actor_id: ctx.user.id,
      actor_role: 'owner',
    }).catch(() => {});
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
