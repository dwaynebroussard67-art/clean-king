import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import PublicHeader from '../../public/header';
import DemoBanner from '../demo-banner';
import { demoModeEnabled } from '../../../lib/auth-config.mjs';
import { ownerLoginEnabled } from '../../../lib/server/supabase';
import { parseSettings } from '../../../lib/assistant-settings-schema.mjs';
import OwnerChat from './owner-chat';

export const dynamic = 'force-dynamic';

function keyStatus(row) {
  const set = row?.set === true;
  return { set, last4: set && typeof row.last4 === 'string' && row.last4.length === 4 ? row.last4 : null };
}

async function readWorkspace() {
  if (!ownerLoginEnabled()) redirect('/owner/login');
  if (process.env.OWNER_ASSISTANT_ENABLED !== 'true') return { error: 'not_configured' };

  // Browsers normally omit Origin on a same-origin GET. Make the strict Section 3.8
  // read on the server, using the configured origin (never a Host header) and this
  // visitor's cookies. Never forward them across a redirect or use a service key.
  const origin = process.env.APP_ORIGIN;
  try {
    const url = new URL('/api/owner/assistant/settings', origin);
    if ((await headers()).get('host')?.toLowerCase() !== url.host) return { error: 'rejected' };
    const response = await fetch(url, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: (await cookies()).toString() },
    });
    const data = await response.json();
    if (!response.ok) {
      const codes = ['not_configured', 'rejected', 'too_large', 'sign_in', 'not_authorized'];
      return { error: codes.includes(data?.error) ? data.error : 'provider_failed' };
    }
    const parsed = parseSettings(data.settings);
    if (!parsed.ok || !Number.isSafeInteger(data.version) || data.version < 0 || !data.secrets) {
      return { error: 'not_configured' };
    }
    return {
      settings: parsed.value, version: data.version, encryptionReady: data.encryptionReady === true,
      secrets: { anthropic: keyStatus(data.secrets.anthropic), custom: keyStatus(data.secrets.custom) },
    };
  } catch {
    return { error: 'not_configured' };
  }
}

export default async function AssistantPage() {
  const initial = await readWorkspace();
  // The settings endpoint authenticates the session AND checks owner membership.
  if (initial.error === 'sign_in') redirect('/owner/login');
  if (initial.error === 'not_authorized') redirect('/owner');
  return (
    <div className="public-page">
      <PublicHeader />
      <DemoBanner enabled={demoModeEnabled(process.env)} />
      <main className="as-shell"><OwnerChat initial={initial} /></main>
    </div>
  );
}
