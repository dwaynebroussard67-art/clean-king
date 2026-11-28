import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public demo uses generic owner placeholders in both languages', async () => {
  const ui = (await readFile(new URL('../app/ui.js', import.meta.url), 'utf8')) +
    (await readFile(new URL('../lib/demo-copy.mjs', import.meta.url), 'utf8'));
  assert.match(ui, /about:'About the owner'/);
  assert.match(ui, /about:'Sobre el propietario'/);
  assert.match(ui, /welcome:'Good morning'/);
  assert.match(ui, /welcome:'Buenos días'/);
  assert.match(ui, /aboutCopy:'Learn about the owner/);
  assert.match(ui, /aboutCopy:'Conoce al propietario/);
  assert.match(ui, /assistantHello:'Hello!/);
  assert.match(ui, /assistantHello:'¡Hola!/);
  assert.match(ui, /<strong>\{lang==='en'\?'Owner':'Propietario'\}<\/strong>/);
});
