import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('company home is public, owner-attributed and navigable on a phone', async ({ page }) => {
  const ownerCalls = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/owner/')) ownerCalls.push(r.url()); });
  await page.goto('/');
  await expect(page).toHaveTitle(/Louisiana Commercial Janitor/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our People Are Our Assets.');
  await expect(page.getByRole('button', { name: 'Open Bubbles Assistant' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next field photo' }).click();
  await expect(page.locator('.lcj-field-caption')).toContainText('Floors & entryways');
  await page.getByRole('button', { name: 'Previous field photo' }).click();
  await expect(page.locator('.lcj-field-caption')).toContainText('Glass & surface care');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Site navigation' }).getByRole('link', { name: 'Our people' }).click();
  await expect(page).toHaveURL(/#people$/);
  await expect(page.locator('#people')).toContainText('Andy Merchant');
  await page.getByText('On our business page', { exact: true }).click();
  await expect(page.locator('.lcj-page-note p')).toBeVisible();
  await page.locator('.lcj-planning summary').first().click();
  await expect(page.getByRole('link', { name: 'Plan a request' }).first()).toHaveAttribute('href', '/quote');
  await expect(page.getByRole('link', { name: 'Workspace preview' })).toHaveAttribute('href', '/workspace');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.lcj-site').analyze()).violations).toEqual([]);
  expect(ownerCalls).toEqual([]);
});

test('Spanish public navigation preserves language into the crew application', async ({ page }) => {
  await page.goto('/'); await page.getByRole('link', { name: 'Español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nuestra gente es nuestro mayor valor.');
  await page.getByRole('link', { name: 'Solicitud de empleo', exact: true }).click();
  await expect(page).toHaveURL(/\/apply\?lang=es$/);
  await expect(page.getByRole('heading', { name: 'Únete al equipo.' })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join the crew.' })).toBeVisible();
});
