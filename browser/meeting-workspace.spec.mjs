import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function navigate(page, name) {
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:new RegExp('^'+name)}).click();
}

test('meeting walkthrough updates local examples without real submissions',async({page})=>{
 const errors=[]; const api=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/'))api.push(req.url())});
 await page.goto('/workspace');
 await expect(page.getByText('Example workspace · Changes stay in this browser until the page is refreshed')).toBeVisible();
 await expect(page.getByText(/DEMO WORKSPACE|Demo only|· DEMO/)).toHaveCount(0);
 await page.getByRole('button',{name:/New applicants 03/}).click();
 await page.getByRole('button',{name:'Add example applicant'}).click();
 await expect(page.getByText(/Use fictional names, not real personal information/)).toBeVisible();
 const accessibility=await new AxeBuilder({page}).include('.example-modal').withRules(['label','button-name','aria-valid-attr','aria-required-attr','duplicate-id-aria']).analyze();
 expect(accessibility.violations).toEqual([]);
 await page.getByLabel('Fictional name').fill('Example Person');
 await page.getByLabel('Example town').fill('Example Town');
 await page.getByLabel('Transportation').selectOption('no');
 await page.getByLabel('Referred by (optional)').fill('Example Teammate');
 await page.getByRole('button',{name:'Review example'}).click();
 await expect(page.getByText('The referral is an example, not verified attribution.')).toBeVisible();
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.getByLabel('Fictional name')).toHaveValue('Example Person');
 await page.getByRole('button',{name:'Review example'}).click();
 await page.getByRole('button',{name:'Add to workspace'}).click();
 await expect(page.getByRole('heading',{name:'Example Person'})).toBeVisible();
 await expect(page.locator('.detail').filter({hasText:'TRANSPORTATION'})).toContainText('No');
 await page.getByRole('button',{name:'Hire',exact:true}).click();
 await expect(page.getByRole('region',{name:'Onboarding preparation'})).toBeVisible();
 await page.getByLabel('Review employment documents').check();
 await expect(page.getByText('No account, training assignment or real shift has been created.',{exact:false})).toBeVisible();
 await navigate(page,'Coverage board');
 await page.getByRole('button',{name:'Simulate call-out'}).click();
 await expect(page.getByText(/Suggested backup, not contacted/)).toBeVisible();
 await expect(page.getByText('Eligible · not contacted').first()).toBeVisible();
 await navigate(page,'Training academy');
 await page.getByRole('button',{name:'Start lesson'}).click();
 await expect(page.getByText('Review the approved site instructions', {exact:false})).toBeVisible();
 await expect(page.getByText('Viewing a lesson here is not proof of training.')).toBeVisible();
 await page.getByRole('button',{name:'Mark as viewed'}).click();
 await navigate(page,'Assistant');
 await page.getByRole('button',{name:/What needs my attention today/}).click();
 await expect(page.getByText(/nobody was contacted/)).toBeVisible();
 await expect(page.getByText(/viewed 1 of 3 example lessons/)).toBeVisible();
 expect(api).toEqual([]);expect(errors).toEqual([]);
 await page.reload();await navigate(page,'Hiring');
 await expect(page.getByRole('heading',{name:'Example Person'})).toHaveCount(0);
 await expect(page.getByText('Maria Reyes').first()).toBeVisible();
});

test('Spanish workspace and map remain honest about example information',async({page})=>{
 await page.goto('/workspace');
 await page.getByRole('button',{name:'EN · Switch to Spanish'}).click();
 await expect(page.locator('html')).toHaveAttribute('lang','es');
 await navigate(page,'Contratación');
 await page.getByRole('button',{name:'Añadir candidato de ejemplo'}).click();
 await expect(page.getByText(/Usa nombres ficticios/)).toBeVisible();
 await page.getByRole('button',{name:'Cerrar'}).click();
 await navigate(page,'Mapas e indicaciones');
 await expect(page.getByText(/planos e indicaciones reales/).first()).toBeVisible();
 await page.getByRole('button',{name:'Baños'}).click();
 await expect(page.getByText(/tareas y los suministros aprobados/)).toBeVisible();
});

test('services and quote planning are interactive without producing or sending a quote',async({page})=>{
 const requests=[];page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/'))requests.push(req.url())});
 await page.goto('/#services');
 await expect(page.getByRole('heading',{name:'A cleaner place to do good work.'})).toBeVisible();
 await page.getByRole('button',{name:'View service'}).first().click();
 await expect(page.getByText('Learning spaces and shared areas')).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).first().click();
 await page.getByLabel('Type of space').selectOption('Medical office');
 await page.getByLabel('Frequency').selectOption('Weekly');
 await page.getByLabel('Floors').check();
 await page.getByRole('button',{name:'Build example plan'}).click();
 await expect(page.getByRole('status')).toContainText('Medical office · Weekly');
 await expect(page.getByRole('status')).toContainText('Floors');
 await expect(page.getByRole('status')).toContainText('Not a quote, price or contract.');
 expect(requests).toEqual([]);
 await page.reload();await expect(page.getByRole('status')).toHaveCount(0);
});
