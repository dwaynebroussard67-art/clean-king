import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const api = '/api/owner/assistant';
const preset = {
  version: 1, enabled: true,
  persona: { name: 'Sparkle', ownerName: 'Andy', tone: 'bubbly', emoji: 'light', length: 'short' },
  voice: { speakReplies: false, rate: 1, pitch: 1, voiceName: null },
  capabilities: { counts: true, emailHealth: true },
  provider: { active: 'anthropic', anthropicModel: 'claude-sonnet-5-5', customBaseUrl: '', customModel: '', fallbackToCustom: false },
  limits: { perMinute: 3, perMonth: 100, maxOutputTokens: 400, temperature: 0.4 },
};
const empty = { set: false, last4: null };
const boot = { settings: preset, version: 7, secrets: { anthropic: empty, custom: empty }, encryptionReady: true };
const ok = (route, data, status = 200) => route.fulfill({ status, json: data, headers: { 'Cache-Control': 'no-store' } });

test.use({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
});

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function openInput(scope) {
  const box = scope.getByRole('textbox');
  if (!await box.isVisible()) {
    const opener = scope.locator('details:not([open]) > summary:visible, button[aria-expanded="false"]:visible').first();
    await opener.focus(); await opener.press('Enter');
  }
  await expect(box).toBeVisible();
  return box;
}

test('public helper answers locally in both languages by keyboard at 375px', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Assistant' }).click();
  const scope = page.locator('.content');
  const box = await openInput(scope);
  await expect(scope.getByText(/Quick answers.*rule-based, not AI/i).first()).toBeVisible();
  const log = scope.locator('[aria-live="polite"]');
  const unexpected = [];
  const origin = new URL(page.url()).origin;
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) unexpected.push(url.origin + url.pathname);
  });
  for (const [question, result] of [
    ['12*(3+4)', /\b84\b/], ['15% of 240', /\b36\b/], ['500 sq ft to sq m', /46\.45/],
    ['6pm to 10pm', /4 hours/i], ['22:00 to 06:00', /8 hours/i],
    ['hours for 5000 sq ft with 2 cleaners', /2\.5 hours/i], ['1/0', /can[’']t compute|cannot compute/i],
  ]) {
    await box.fill(question); await box.press('Enter');
    await expect(log).toContainText(result); await expect(box).toHaveValue('');
  }
  await page.getByRole('button', { name: 'EN · Switch to Spanish' }).click();
  await openInput(scope); await box.fill('2,5 más 3'); await box.press('Enter');
  await expect(log).toContainText(/5,5/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await noOverflow(page);
  expect((await new AxeBuilder({ page }).include('.content').withRules(['label', 'button-name', 'aria-valid-attr']).analyze()).violations).toEqual([]);
  expect(unexpected).toEqual([]);
});

for (const path of ['/apply', '/quote']) {
  test(`collapsed public helper follows the ${path} form language`, async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.goto(`${path}?lang=es`);
    const details = page.locator('details.as-help');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('summary')).toContainText('Respuestas rápidas');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(details.locator('summary')).toContainText('Quick answers');
    await details.locator('summary').press('Enter');
    const input = await openInput(details);
    await input.fill('12*(3+4)'); await input.press('Enter');
    await expect(details.locator('[aria-live="polite"]')).toContainText('84');
    await noOverflow(page);
  });
}

// A browser route cannot intercept a Server Component's authenticated GET. Run the
// real owner page in an isolated Next fixture with a synthetic GET at that boundary.
// Browser writes are intercepted by Playwright. No test route/flag in the product,
// no copied .env, live project, provider, extra dependency or test-only owner login.
const mockGet = `
import { readFile } from 'node:fs/promises';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (req.headers.get('origin') !== process.env.APP_ORIGIN || req.headers.get('content-type') !== 'application/json') {
    return Response.json({error:'rejected'}, {status:403});
  }
  if (!req.headers.get('cookie')?.includes('fixture-owner=yes')) return Response.json({error:'sign_in'}, {status:401});
  return Response.json(JSON.parse(await readFile('workspace.json','utf8')), {headers:{'Cache-Control':'no-store'}});
}`;

test.describe('owner assistant with a synthetic HTTP boundary', () => {
  let dir, child, origin;
  const seed = data => writeFile(join(dir, 'workspace.json'), JSON.stringify(data));
  async function put(path, text) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    dir = await mkdtemp(join(tmpdir(), 'goodwork-assistant-ui-'));
    for (const path of ['app/layout.js', 'app/globals.css', 'app/public/header.js', 'app/owner/demo-banner.js',
      'app/owner/assistant', 'lib/auth-config.mjs', 'lib/server/supabase.js']) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await cp(join(root, path), join(dir, path), { recursive: true });
    }
    await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    await put('package.json', '{"private":true,"name":"assistant-ui-test"}');
    await put('lib/assistant-settings-schema.mjs', 'export const parseSettings = value => ({ok: value?.version === 1, value});');
    await put('app/api/owner/assistant/settings/route.js', mockGet);
    const socket = createServer();
    await new Promise((resolve, reject) => socket.once('error', reject).listen(0, 'localhost', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    origin = `http://localhost:${port}`;
    child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'),
      'dev', '--webpack', '--hostname', 'localhost', '--port', String(port)], {
      cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], env: {
        PATH: process.env.PATH, HOME: dir, CI: '1', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic',
        APP_ORIGIN: origin, OWNER_EMAIL_LINK_ENABLED: 'true', OWNER_ASSISTANT_ENABLED: 'true',
      },
    });
    await new Promise((resolve, reject) => {
      let tail = '';
      child.once('error', reject);
      child.once('exit', () => reject(Error('Isolated owner fixture stopped before startup.')));
      child.stdout.on('data', chunk => {
        tail = (tail + chunk.toString()).slice(-1024);
        if (/ready in/i.test(tail)) resolve();
      });
    });
  });
  test.afterAll(async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close'); child.kill('SIGTERM'); await closed;
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90_000);
    await seed(boot);
    await context.addCookies([{ url: origin, name: 'fixture-owner', value: 'yes', httpOnly: true }]);
  });
  const visit = page => page.goto(`${origin}/owner/assistant`);

  test('chat sends only bounded alternating history; credits the real response metadata', async ({ page }) => {
    let last;
    await page.route(`**${api}`, route => {
      last = route.request().postDataJSON();
      return ok(route, { answer: 'Example answer. ' + 'x'.repeat(1100), meta: { provider: 'custom', model: 'fixture-model' } });
    });
    await visit(page);
    await expect(page.getByRole('heading', { name: 'Sparkle' })).toBeVisible();
    const question = page.getByLabel('Your question', { exact: true });
    for (let i = 1; i <= 5; i++) {
      await question.fill(`Example ${i}`); await page.getByRole('button', { name: 'Send question' }).click();
      await expect(page.getByText('Answered by Custom · fixture-model')).toHaveCount(i);
    }
    expect(Object.keys(last).sort()).toEqual(['history', 'language', 'message']);
    expect(last.history.map(h => h.role)).toEqual(['user','assistant','user','assistant','user','assistant']);
    expect(last.history[0].text).toBe('Example 2');
    expect(last.history.every(h => h.text.length <= 1000 && Object.keys(h).length === 2)).toBe(true);
    await page.getByRole('button', { name: 'Español' }).click();
    await page.getByLabel('Tu pregunta', { exact: true }).fill('Ejemplo');
    await page.getByRole('button', { name: 'Enviar pregunta' }).click();
    await expect(page.getByText('Respondió Personalizado · fixture-model')).toHaveCount(6);
    expect(last.language).toBe('es');
    await page.getByLabel('Tu pregunta', { exact: true }).fill('界'.repeat(2500));
    await page.getByRole('button', { name: 'Enviar pregunta' }).click();
    await expect(page.getByText('Respondió Personalizado · fixture-model')).toHaveCount(7);
    expect(last.history).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(last))).toBeLessThanOrEqual(8192);
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).include('.as-workspace').analyze()).violations).toEqual([]);
  });

  test('chat failures retain the question and offer the appropriate recovery', async ({ page }) => {
    let reply;
    await page.route(`**${api}`, route => ok(route, { error: reply[1] }, reply[0]));
    await visit(page);
    await page.getByLabel('Your question', { exact: true }).fill('Example');
    for (reply of [
      [429, 'rate_limited', 'minute or monthly limit'], [503, 'disabled', 'switched off'],
      [503, 'provider_not_set', 'needs a key'], [503, 'provider_failed', 'could not complete'],
      [503, 'not_configured', 'not configured'], [403, 'rejected', 'was rejected'], [413, 'too_large', 'too large'],
      [400, 'invalid', 'check the highlighted fields'], [401, 'sign_in', 'session ended'],
    ]) {
      await page.getByRole('button', { name: 'Send question' }).click();
      const alert = page.getByRole('alert'); await expect(alert).toContainText(reply[2]);
      if (reply[1] === 'sign_in') await expect(alert.getByRole('link')).toHaveAttribute('href', '/owner/login');
      if (['disabled','provider_not_set'].includes(reply[1])) await expect(alert.getByRole('link')).toHaveAttribute('href', '#as-settings');
    }
    await expect(page.getByRole('log')).toHaveCount(0);
    await visit(page);
    reply = [403, 'not_authorized'];
    const question = page.getByLabel('Your question', { exact: true });
    await question.fill('Example'); await question.press('Enter');
    await expect(page.getByRole('alert')).toContainText('does not have owner access');
    await expect(page.getByRole('heading', { name: 'Assistant settings' })).toHaveCount(0);
  });

  test('settings save uses expectedVersion; conflicts require reload and field errors stay local', async ({ page }) => {
    let attempt = 0;
    await page.route(`**${api}/settings`, async route => {
      expect(route.request().method()).toBe('PUT');
      const { settings, expectedVersion } = route.request().postDataJSON();
      if (++attempt === 1) {
        expect(expectedVersion).toBe(7);
        await seed({ ...boot, version: 8 });
        return ok(route, { error: 'conflict' }, 409);
      }
      expect(expectedVersion).toBe(8);
      if (attempt === 2) return ok(route, { error: 'invalid', errors: [{ path: 'persona.name', message: 'Invalid name' }] }, 422);
      return ok(route, { settings, version: 9 });
    });
    await visit(page);
    const name = page.getByLabel('Assistant name', { exact: true }), save = page.getByRole('button', { name: 'Save settings' });
    await name.fill('Sample'); await expect(page.getByText('Unsaved changes')).toBeVisible(); await save.click();
    await expect(page.getByRole('alert')).toContainText('changed elsewhere'); await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Reload latest' }).click(); await expect(name).toHaveValue('Sparkle');
    await name.fill('Sample!'); await save.click(); await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription(/letters, digits/);
    await name.fill('Sample'); await save.click(); await expect(page.getByRole('heading', { name: 'Sample' })).toBeVisible();
    await expect(page.getByText('Settings saved.')).toBeVisible(); await expect(save).toBeDisabled();
  });

  test('saved provider and capability edits start a fresh conversation', async ({ page }) => {
    let saved;
    const historySizes = [];
    await page.route(`**${api}`, route => {
      historySizes.push(route.request().postDataJSON().history.length);
      return ok(route, { answer: 'Example count', meta: { provider: saved ? 'custom' : 'anthropic', model: 'fixture' } });
    });
    await page.route(`**${api}/settings`, route => {
      saved = route.request().postDataJSON();
      return ok(route, { settings: saved.settings, version: 8 });
    });
    await visit(page);
    const question = page.getByLabel('Your question', { exact: true });
    await question.fill('Example count?'); await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByRole('log')).toContainText('Answered by Anthropic');
    await page.getByRole('radio', { name: 'Custom', exact: true }).check();
    await page.getByLabel('Custom base URL').fill('https://synthetic.example.test/v1');
    await page.getByLabel('Custom model').fill('fixture');
    await page.getByLabel('Queued and failed application emails').uncheck();
    await page.getByLabel('Tone', { exact: true }).selectOption('professional');
    await page.getByLabel(/^Speaking rate/).fill('1.25');
    await page.getByLabel(/^Runs per minute/).fill('2');
    await expect(page.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    expect(saved).toEqual({ expectedVersion: 7, settings: {
      ...preset, persona: { ...preset.persona, tone: 'professional' }, voice: { ...preset.voice, rate: 1.25 },
      capabilities: { ...preset.capabilities, emailHealth: false }, limits: { ...preset.limits, perMinute: 2 },
      provider: { ...preset.provider, active: 'custom', customBaseUrl: 'https://synthetic.example.test/v1', customModel: 'fixture' },
    } });
    await expect(page.getByRole('log')).toBeEmpty();
    await question.fill('Another example?'); await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByRole('log')).toContainText('Answered by Custom');
    expect(historySizes).toEqual([0, 0]);
  });

  test('keys are write-only; test uses saved configuration and reports success, failure and quota', async ({ page }) => {
    const fixtureKey = 'synthetic-only-1234'; let writes = 0, tests = 0;
    await page.route(`**${api}/settings/secret`, route => {
      const body = route.request().postDataJSON();
      expect(body.name).toBe('custom');
      if (++writes === 1) expect(body.value === fixtureKey && !('clear' in body)).toBe(true);
      else expect(body).toEqual({ name: 'custom', clear: true });
      return ok(route, { secrets: { anthropic: empty, custom: writes === 1 ? { set: true, last4: '1234' } : empty } });
    });
    await page.route(`**${api}/settings/test`, route => {
      expect(route.request().postDataJSON()).toEqual({});
      if (++tests === 1) return ok(route, { ok: true, provider: 'custom', model: 'fixture', latencyMs: 23 });
      if (tests === 2) return ok(route, { ok: false, code: 'auth' });
      return ok(route, { error: 'rate_limited' }, 429);
    });
    await visit(page);
    const field = page.getByLabel('Custom · API key', { exact: true }), form = page.locator('.as-key').filter({ has: field });
    await expect(field).toHaveAttribute('type', 'password'); await field.fill(fixtureKey);
    await form.getByRole('button', { name: 'Save key' }).click(); await expect(form).toContainText('••••1234');
    await expect(field).toHaveValue(''); expect((await page.locator('body').innerText()).includes(fixtureKey)).toBe(false);
    await form.getByRole('button', { name: 'Remove key' }).click(); await expect(form).toContainText('No saved key');
    const button = page.getByRole('button', { name: 'Test connection' });
    await button.click(); await expect(page.getByText('Connected: Custom · fixture · 23 ms')).toBeVisible();
    await button.click(); await expect(page.getByText(/did not accept these credentials/)).toBeVisible();
    await button.click(); await expect(page.getByRole('alert')).toContainText('minute or monthly limit');
  });

  test('a signed-out settings read never renders owner controls', async ({ page, context }) => {
    await context.clearCookies();
    await visit(page);
    await expect(page).toHaveURL(`${origin}/owner/login`);
    await expect(page.getByRole('heading', { name: 'Assistant settings' })).toHaveCount(0);
  });

  test('disabled assistant and unavailable encryption do not expose active inputs', async ({ page }) => {
    await seed({ ...boot, settings: { ...preset, enabled: false }, encryptionReady: false });
    await visit(page);
    await expect(page.getByLabel('Your question', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Anthropic · API key', { exact: true })).toBeDisabled();
    await expect(page.getByText(/Key editing is disabled/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save key' }).first()).toBeDisabled();
  });

  test('device voice, preview, stop and mute never change the provider payload', async ({ page }) => {
    await seed({ ...boot, settings: { ...preset, voice: { speakReplies: true, rate: 1.5, pitch: 0.8, voiceName: 'Sample Voice' } } });
    await page.addInitScript(() => {
      window.spoken = []; window.stops = 0;
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { value: Object.assign(new EventTarget(), {
        getVoices: () => [{ name: 'Sample Voice' }], cancel: () => { window.stops++; },
        speak: u => window.spoken.push([u.rate, u.pitch, u.voice?.name]),
      }) });
    });
    await page.route(`**${api}`, route => {
      expect(Object.keys(route.request().postDataJSON()).sort()).toEqual(['history', 'language', 'message']);
      return ok(route, { answer: 'Example', meta: { provider: 'anthropic', model: 'fixture' } });
    });
    await visit(page); await page.getByRole('button', { name: 'Preview voice' }).click();
    await page.getByLabel('Your question', { exact: true }).fill('First'); await page.getByRole('button', { name: 'Send question' }).click();
    await expect.poll(() => page.evaluate(() => window.spoken)).toEqual([[1.5, 0.8, 'Sample Voice'], [1.5, 0.8, 'Sample Voice']]);
    const before = await page.evaluate(() => window.stops);
    await page.getByRole('button', { name: 'Stop voice' }).click(); expect(await page.evaluate(() => window.stops)).toBeGreaterThan(before);
    await page.getByRole('button', { name: 'Mute replies' }).click();
    await page.getByLabel('Your question', { exact: true }).fill('Second'); await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByText('Answered by Anthropic · fixture')).toHaveCount(2);
    expect(await page.evaluate(() => window.spoken.length)).toBe(2);
  });
});
