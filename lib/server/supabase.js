import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { developmentLoginEnabled, developmentIntakeConfig } from '../auth-config.mjs';

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
export function intakeConfig() { return developmentIntakeConfig(process.env); }
export function ownerLoginEnabled() { return developmentLoginEnabled(process.env); }

// Still development only until employee authentication, rate limiting and production review are complete.
export function referralsEnabled() { return process.env.REFERRALS_ENABLED === 'true' && !!intakeConfig() && ownerLoginEnabled(); }
