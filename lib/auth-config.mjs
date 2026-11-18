// Email-link owner access is strictly for local development and automated tests.
// A production build must not accidentally enable it instead of the required passkeys.
export function developmentLoginEnabled(env) {
  if (!['development', 'test'].includes(env.NODE_ENV) || env.OWNER_EMAIL_LINK_ENABLED !== 'true' || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.APP_ORIGIN) return false;
  try {
    const url = new URL(env.APP_ORIGIN);
    return url.origin === env.APP_ORIGIN && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'));
  } catch { return false; }
}

// Until production authentication and operational safeguards exist, public intake is test-only too.
export function developmentIntakeConfig(env) {
  if (!['development','test'].includes(env.NODE_ENV) || env.INTAKE_ENABLED !== 'true' || !env.APP_ORIGIN || !env.TURNSTILE_SECRET_KEY || !env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = new URL(env.APP_ORIGIN);
    if (url.origin !== env.APP_ORIGIN || !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'))) return null;
    return { origin: env.APP_ORIGIN, hostname: url.hostname, secret: env.TURNSTILE_SECRET_KEY, siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY };
  } catch { return null; }
}
