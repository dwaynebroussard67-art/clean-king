// Security headers for the synthetic demo build. The CSP allows exactly the third
// parties this app actually uses (Cloudflare Turnstile) plus Supabase, and denies
// framing, plugins, and cross-origin form posts. Everything else is denied by default.
//
// Development-only accommodation: the Arena live preview embeds the dev server in
// an iframe and Next's dev runtime needs eval + websocket HMR. Those relaxations
// apply ONLY when NODE_ENV !== 'production'; production/Vercel headers are
// byte-for-byte the locked-down policy below.
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `media-src 'self'${isDev ? ' blob:' : ''}`,
  "font-src 'self' data:",
  `connect-src 'self' ${isDev ? 'ws: wss: ' : ''}https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["frame-ancestors 'none'"]),
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  ...(isDev ? [] : [{ key: 'X-Frame-Options', value: 'DENY' }]),
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  },
  // HSTS is harmless on HTTP and load-bearing on HTTPS (preview/production).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
