import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const endpoint = '**/api/owner/assistant';
const meta = { provider: 'custom', model: 'example-model' };
let dir, child, origin;

// Exercise the actual client component with the props normally supplied by the
// authenticated server page. The temporary fixture has no provider, credentials,
// auth module or database. No bypass route or test flag is installed in the app.
const fixturePage = `
import OwnerChat from './owner-chat';
export default async function Page({ searchParams }) {
  const { off } = await searchParams;
  return <main className="owner-main assistant-owner"><h1>Chat fixture</h1>
    <OwnerChat enabled={!off} personaName="Example" ownerName="Owner" speakReplies
      rate={1.25} pitch={0.8} voiceName="Example voice" />
  </main>;
}`;

test.use({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
test.beforeAll(async () => {
  test.setTimeout(120000);
  dir = await mkdtemp(join(tmpdir(), 'clean-king-owner-chat-'));
  const app = join(dir, 'app');
  await mkdir(app);
  for (const file of ['owner-chat.js', 'settings.css']) {
    await cp(join(root, 'app/owner/assistant', file), join(app, file));
  }
  for (const file of ['layout.js', 'globals.css']) await cp(join(root, 'app', file), join(app, file));
  await writeFile(join(app, 'page.js'), fixturePage);
  await writeFile(join(dir, 'package.json'), '{"private":true,"name":"owner-chat-fixture"}');
  for (const name of ['node_modules', 'public']) await symlink(join(root, name), join(dir, name), 'dir');

  const socket = createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'),
    'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: dir, stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH, HOME: dir, CI: '1', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' },
  });
  await new Promise((resolve, reject) => {
    let tail = '';
    child.once('error', reject);
    child.once('exit', () => reject(Error('Chat fixture stopped before startup.')));
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

test.beforeEach(async ({ page }) => {
  test.setTimeout(90000);
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
});

const json = (route, body, status = 200) => route.fulfill({ status, json: body });

test('owner chat bounds history by pairs, characters and bytes; supports keyboard and Spanish', async ({ page }) => {
  let payload;
  await page.route(endpoint, route => {
    expect(route.request().method()).toBe('POST');
    payload = route.request().postDataJSON();
    return json(route, { answer: 'Example ' + 'x'.repeat(1100), meta });
  });
  await page.goto(origin);
  const input = page.getByLabel('Your question', { exact: true });
  for (let i = 1; i <= 5; i++) {
    await input.fill(`Example ${i}`); await input.press('Enter');
    await expect(page.getByText('Answered by Custom · example-model')).toHaveCount(i);
  }
  expect(Object.keys(payload).sort()).toEqual(['history', 'language', 'message']);
  expect(payload.history.map(h => h.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  expect(payload.history[0].text).toBe('Example 2');
  expect(payload.history.every(h => h.text.length <= 1000 && Object.keys(h).length === 2)).toBe(true);
  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.getByLabel('Tu pregunta', { exact: true }).fill('界'.repeat(2500));
  await page.getByRole('button', { name: 'Enviar pregunta' }).click();
  await expect(page.getByText('Respondió Personalizado · example-model')).toHaveCount(6);
  expect(payload.language).toBe('es');
  expect(payload.history).toEqual([]);
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(8192);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.as-chat-shell').analyze()).violations).toEqual([]);
});

test('transient errors retain the draft, settings errors link to the real page and session loss clears chat', async ({ page }) => {
  let failure;
  await page.route(endpoint, r => failure ? json(r, { error: failure[1] }, failure[0]) : json(r, { answer: 'Example answer', meta }));
  await page.goto(origin);
  const input = page.getByLabel('Your question', { exact: true });
  await input.fill('Example'); await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('Example answer');
  await input.fill('Another example');
  for (failure of [[429, 'rate_limited'], [503, 'provider_not_set'], [401, 'sign_in']]) {
    await input.press('Enter');
    const alert = page.locator('.as-chat-shell').getByRole('alert');
    if (failure[0] === 429) {
      await expect(alert).toContainText('minute or monthly limit'); await expect(input).toHaveValue('Another example');
    } else if (failure[0] === 503) {
      await expect(alert.getByRole('link')).toHaveAttribute('href', '/owner/assistant/settings');
    } else {
      await expect(alert.getByRole('link')).toHaveAttribute('href', '/owner/login');
      await expect(page.getByRole('log')).toHaveCount(0); await expect(input).toHaveCount(0);
    }
  }
});

test('mute works while a reply is in flight; unmuted playback honors the configured voice', async ({ page }) => {
  await page.addInitScript(() => {
    window.spoken = []; window.stops = 0;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class {} });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [{ name: 'Example voice' }], cancel: () => { window.stops++; },
      speak: u => window.spoken.push([u.rate, u.pitch, u.voice?.name, u.lang]),
    } });
  });
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route(endpoint, async r => { await wait; return json(r, { answer: 'Example answer', meta }); });
  await page.goto(origin);
  const input = page.getByLabel('Your question', { exact: true }), mute = page.getByRole('button', { name: 'Mute replies' });
  await input.fill('First'); await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('Waiting');
  await mute.click(); release();
  await expect(page.getByRole('log')).toContainText('Example answer');
  expect(await page.evaluate(() => window.spoken)).toEqual([]);
  await mute.click(); await input.fill('Second'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.spoken)).toEqual([[1.25, 0.8, 'Example voice', 'en']]);
  const before = await page.evaluate(() => window.stops);
  await page.getByRole('button', { name: 'Stop speaking' }).click();
  expect(await page.evaluate(() => window.stops)).toBeGreaterThan(before);
});

test('a disabled owner assistant offers settings, not a send action', async ({ page }) => {
  await page.goto(`${origin}/?off=1`);
  await expect(page.getByRole('alert').getByRole('link')).toHaveAttribute('href', '/owner/assistant/settings');
  await expect(page.getByLabel('Your question', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send question' })).toBeDisabled();
});
