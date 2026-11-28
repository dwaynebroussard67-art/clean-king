// Security headers for the synthetic demo build. The CSP allows exactly the third
// parties this app actually uses (Cloudflare Turnstile) plus Supabase, and denies
// framing, plugins, and cross-origin form posts. Everything else is denied by default.
// Embedding is opt-in, for an unconfigured local development preview only.
// A deployed/configured app retains its anti-framing policy.
const development = process.env.NODE_ENV === 'development';
const arenaPreview = development && process.env.LCJ_ARENA_PREVIEW === '1'
  && !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY;
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${arenaPreview ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      arenaPreview ? "frame-ancestors 'self' https://arena.ai https://*.arena.ai https://*.e2b.app" : "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  ...(arenaPreview ? [] : [{ key: 'X-Frame-Options', value: 'DENY' }]),
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
  devIndicators: false,
  ...(arenaPreview ? { allowedDevOrigins: ['*.e2b.app'], distDir: '.cache/lcj-preview' } : {}),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
