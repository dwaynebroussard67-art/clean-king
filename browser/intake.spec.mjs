import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function mockVerification(page) {
  await page.route('https://challenges.cloudflare.com/**', route=>route.fulfill({contentType:'application/javascript',body:`window.turnstile={render:function(el,o){window.mockTurnstileCallback=o.callback;setTimeout(()=>o.callback('synthetic-token'),0);return 'synthetic-widget'},reset:function(){setTimeout(()=>window.mockTurnstileCallback('synthetic-token'),0)},remove:function(){}};`}));
}
async function fillApplication(page,lang='en') {
  await page.locator('[name=firstName]').fill('Example');
  await page.locator('[name=phone]').fill('3375550199');
  await page.locator('[name=area]').fill('Example');
  await page.locator('[name=shifts][value=nights]').check();
  await page.locator('[name=transportation]').selectOption('yes');
  await page.locator(`[name=languages][value=${lang}]`).check();
}

test('referral application can be reviewed, edited and submitted without sending early',async({page})=>{
  await mockVerification(page);
  const submissions=[];
  await page.route('**/api/intake',async route=>{submissions.push(route.request().postDataJSON());await route.fulfill({status:200,json:{ok:true}})});
  await page.goto('/apply#ref='+ 'a'.repeat(64));
  await expect(page.locator('[name=referralCode]')).toHaveValue('a'.repeat(64));
  await expect.poll(()=>page.evaluate(()=>location.hash)).toBe('');
  await fillApplication(page);
  await page.locator('[name=experienceLevel]').selectOption('one_to_three');
  await page.locator('[name=commercialExperience]').selectOption('yes');
  await page.getByRole('button',{name:'Review application'}).click();
  await expect(page.getByRole('heading',{name:'Review your application'})).toBeFocused();
  expect(submissions).toHaveLength(0);
  await page.getByRole('button',{name:'Edit application'}).click();
  await expect(page.locator('[name=firstName]')).toBeFocused();
  await page.locator('[name=area]').fill('Lafayette');
  await page.getByRole('button',{name:'Review application'}).click();
  await page.getByRole('button',{name:'Submit application'}).click();
  await expect(page.getByRole('status')).toContainText('received');
  expect(submissions).toHaveLength(1);
  expect(submissions[0].data).toMatchObject({area:'Lafayette',referralCode:'a'.repeat(64),experienceLevel:'one_to_three',commercialExperience:'yes',residentialExperience:null});
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('goodwork:intake:')))).toEqual([]);
});

test('uncertain response keeps only an opaque request ID across reload for a safe retry',async({page})=>{
  await mockVerification(page); const submissions=[];
  await page.route('**/api/intake',async route=>{submissions.push(route.request().postDataJSON());await route.fulfill({status:submissions.length===1?503:200,json:{ok:submissions.length!==1}})});
  await page.goto('/apply'); await fillApplication(page);
  await page.getByRole('button',{name:'Review application'}).click();await page.getByRole('button',{name:'Submit application'}).click();
  await expect(page.locator('.form-error')).toContainText('Something went wrong');
  const stored=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('goodwork:intake:')));
  expect(stored).toEqual([['goodwork:intake:v1:application',submissions[0].requestId]]);
  await page.reload(); await fillApplication(page);
  await page.getByRole('button',{name:'Review application'}).click();await page.getByRole('button',{name:'Submit application'}).click();
  await expect(page.getByRole('status')).toContainText('received');expect(submissions[1].requestId).toBe(submissions[0].requestId);
});

test('conflicting request warns before explicitly starting over',async({page})=>{
  await mockVerification(page);const ids=[];
  await page.route('**/api/intake',async route=>{ids.push(route.request().postDataJSON().requestId);await route.fulfill({status:ids.length===1?409:200,json:{}})});
  await page.goto('/apply');await fillApplication(page);
  await page.getByRole('button',{name:'Review application'}).click();await page.getByRole('button',{name:'Submit application'}).click();
  await expect(page.locator('.form-error')).toContainText('may have been received');
  await expect(page.getByRole('button',{name:'Submit application'})).toBeDisabled();
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Start a new request'}).click()]);await fillApplication(page);
  await page.getByRole('button',{name:'Review application'}).click();await page.getByRole('button',{name:'Submit application'}).click();
  await expect(page.getByRole('status')).toContainText('received');expect(ids[1]).not.toBe(ids[0]);
});

test('Spanish review, quote submission, and selected mobile accessibility checks',async({page})=>{
  await mockVerification(page);const submissions=[];
  await page.route('**/api/intake',async route=>{submissions.push(route.request().postDataJSON());await route.fulfill({status:200,json:{ok:true}})});
  await page.goto('/apply');await page.getByRole('button',{name:'Español'}).click();await expect(page.locator('html')).toHaveAttribute('lang','es');
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await fillApplication(page,'es');await page.getByRole('button',{name:'Revisar solicitud'}).click();
  await expect(page.getByRole('heading',{name:'Revisa tu solicitud'})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Enviar solicitud'}).click();await expect(page.getByRole('status')).toContainText('Recibimos');
  expect(submissions[0].data.experienceLevel).toBeNull();
  await page.goto('/quote');await page.locator('[name=buildingType]').selectOption('office');await page.locator('[name=size]').fill('Unsure');await page.locator('[name=frequency]').selectOption('weekly');await page.locator('[name=name]').fill('Example');await page.locator('[name=phone]').fill('3375550199');await page.locator('[name=email]').fill('test@example.com');await page.getByRole('button',{name:'Send request'}).click();await expect(page.getByRole('status')).toContainText('received');expect(submissions.at(-1).kind).toBe('quote');
});
