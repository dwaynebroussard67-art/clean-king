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

// Multi-franchise helpers ---------------------------------------------------

/** Look up the organization for a public intake request by its origin.
 *  Each franchise configures its own APP_ORIGIN; the organizations table
 *  stores that origin so the public form can be scoped without auth. */
export async function organizationByOrigin(origin) {
  const admin = adminClient();
  if (!admin || !origin) return null;
  const { data, error } = await admin
    .from('organizations')
    .select('id, name, slug, owner_id, status, default_language')
    .eq('origin', origin)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== 'active') return null;
  return data;
}

/** For authenticated owners, resolve the current organization from memberships.
 *  Returns the first membership's organization (owners with multiple orgs should
 *  eventually pick one explicitly; for day one we default to the first). */
export async function currentOrganization(client) {
  if (!client) return null;
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data, error: mError } = await client
    .from('owner_memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .maybeSingle();
  if (mError || !data) return null;
  return data.organization_id;
}
