import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
export async function sessionClient() {
  const config = publicConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: { getAll: () => store.getAll(), setAll: (items) => { try { items.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Refreshed by middleware for server component requests. */ } } },
  });
}
export function adminClient() {
  const config = publicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !key) return null;
  return createClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function intakeConfig() {
  const origin = process.env.APP_ORIGIN;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (process.env.INTAKE_ENABLED !== 'true' || !origin || !secret || !siteKey || !publicConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost'))) return null;
    return { origin, hostname: url.hostname, secret, siteKey };
  } catch { return null; }
}
export function ownerLoginEnabled() {
  if (process.env.OWNER_EMAIL_LINK_ENABLED !== 'true' || !publicConfig() || !process.env.APP_ORIGIN) return false;
  try { const url = new URL(process.env.APP_ORIGIN); return url.origin === process.env.APP_ORIGIN && (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')); } catch { return false; }
}
