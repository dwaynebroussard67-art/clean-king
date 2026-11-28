import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('business preview preserves its brand and clearly labels unavailable intake', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Louisiana Commercial Janitor home/ })).toBeVisible();
  await expect(page.getByText('Our People Are Our Assets').first()).toBeVisible();
  await expect(page.getByText(/SITE PREVIEW/)).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('link', { name: 'Español' }).click();
  await expect(page.getByRole('heading', { name: /Un espacio más limpio/ })).toBeVisible();
  await page.getByRole('link', { name: /Solicitar cotización/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Hablemos de tu espacio.' })).toBeVisible();
});
