import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('home demo no longer presents a disconnected quote modal', async () => {
  const source = await readFile(new URL('../app/ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /quoteHeading|quoteCopy|real quote form will be connected/i);
  assert.doesNotMatch(source, /setModal\(['"]quote['"]\)/);
  assert.match(source, /href=\{lang==='es'\?'\/quote\?lang=es':'\/quote'\}/);
});
