import {test,expect} from '@playwright/test';

test('closed mobile navigation is inert and menu keeps and restores keyboard focus',async({page})=>{
 await page.goto('/');await page.keyboard.press('Tab');
 await expect(page.getByRole('button',{name:'Open menu'})).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('.sidebar').getByRole('button',{name:'Close menu'})).toBeFocused();
 for(let i=0;i<16;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('.sidebar'))).toBe(true)}
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open menu'})).toBeFocused();
});
test('dialog traps focus, restores opener and supports review focus',async({page})=>{
 await page.goto('/#hiring');const opener=page.getByRole('button',{name:'Add example applicant'});await opener.click();
 await expect(page.getByLabel('Fictional name')).toBeFocused();
 for(let i=0;i<16;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]'))).toBe(true)}
 await page.getByLabel('Fictional name').fill('Example');await page.getByLabel('Example town').fill('Example');await page.getByRole('button',{name:'Review example'}).click();
 await expect(page.getByRole('heading',{name:'Review example'})).toBeFocused();
 await page.keyboard.press('Escape');await expect(opener).toBeFocused();
});
test('public helper works without AI provider on public pages',async({page})=>{
 const calls=[];page.on('request',req=>{if(req.url().includes('/api/'))calls.push(new URL(req.url()).pathname)});
 await page.goto('/apply');await page.getByRole('button',{name:'Help',exact:true}).click();
 await page.getByLabel('Question or calculation').fill('12 * 5');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('60');expect(calls).toEqual(['/api/public/assistant']);
 await page.getByRole('button',{name:'Español',exact:true}).last().click();await page.getByLabel('Pregunta o cálculo').fill('10 / 0');await page.getByRole('button',{name:'Enviar',exact:true}).click();await expect(page.getByRole('status')).toContainText('cero');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Ayuda',exact:true})).toBeFocused();
});

test('meeting settings controls remain explicit browser-only examples',async({page})=>{
 const api=[];page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/'))api.push(req.url())});
 await page.goto('/');await page.getByRole('button',{name:'Open menu'}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Settings',exact:true}).click();
 const preview=page.getByRole('region',{name:'Example assistant settings'});await expect(preview).toContainText('do not configure a provider or activate AI');
 await preview.getByLabel('Provider').selectOption('open');await preview.getByLabel('Text tone').selectOption('calm');await preview.getByLabel('Explore sharing aggregate counts').check();
 expect(api).toEqual([]);await page.reload();expect(api).toEqual([]);
});
