import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brand, publicPath } from '../lib/brand.mjs';
import { siteCopy } from '../app/public/site-copy.mjs';

test('public profile names the supplied business and owner without assuming a franchise identity', () => {
  assert.equal(brand.name, 'Louisiana Commercial Janitor');
  assert.equal(brand.owner, 'Andy Merchant');
  for (const [lang, t] of Object.entries(siteCopy)) {
    assert.equal(`${t.firstLine} ${t.secondLine}`, lang === 'en' ? brand.motto : brand.mottoEs);
    assert.ok(t.ownerCopy.includes(brand.owner) && t.ownerCopy.includes(brand.name));
    assert.doesNotMatch(t.ownerCopy, /jani.king|franchis|clean king|goodwork/i);
  }
  assert.equal(publicPath('/quote', 'es'), '/quote?lang=es');
  assert.equal(publicPath('/apply', 'en'), '/apply');
});

test('the sample workspace still greets the viewer generically in both languages', async () => {
  const ui = await readFile(new URL('../app/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /welcome:'Good morning'/);
  assert.match(ui, /welcome:'Buenos días'/);
  assert.match(ui, /assistantHello:'Hello!/);
  assert.match(ui, /assistantHello:'¡Hola!/);
  assert.match(ui, /<strong>\{lang==='en'\?'Owner':'Propietario'\}<\/strong>/);
});
