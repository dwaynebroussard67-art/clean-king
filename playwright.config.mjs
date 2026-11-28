import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      ...(process.env.PLAYWRIGHT_CHROMIUM_NO_SANDBOX === 'true' ? { args: ['--no-sandbox'] } : {}),
    },
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://localhost:3100/apply',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      INTAKE_ENABLED: 'true', REFERRALS_ENABLED: 'true', OWNER_EMAIL_LINK_ENABLED: 'true',
      APP_ORIGIN: 'http://localhost:3100',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'synthetic-site-key', TURNSTILE_SECRET_KEY: 'synthetic-secret',
    },
  },
});
