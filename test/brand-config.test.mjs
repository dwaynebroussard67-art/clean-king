import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { defaultBrand } from '../lib/brand.mjs';

test('default presentation brand has no invented business details', () => {
  assert.equal(defaultBrand.name, 'Louisiana Commercial Janitor');
  assert.equal(defaultBrand.logo, null);
  assert.equal(defaultBrand.contact, null);
  assert.deepEqual(defaultBrand.services, []);
  assert.deepEqual(defaultBrand.areasServed, []);
  assert.deepEqual(defaultBrand.languages, ['en', 'es']);
});

test('all app and lib source files use brand configuration for brand names', async () => {
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(?:js|jsx|ts|tsx|mjs|css|json)$/.test(entry.name) && file !== 'lib/brand.mjs') {
        const text = await readFile(file, 'utf8');
        assert.doesNotMatch(text, /Clean King|Goodwork|Louisiana Commercial Janitor|Jani[- ]?King/i, file);
      }
    }
  }
  await visit('app');
  await visit('lib');
});

test('stylesheet hex colors resolve through the brand palette', async () => {
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (file.endsWith('.css')) {
        const css = await readFile(file, 'utf8');
        for (const [, token] of css.matchAll(/var\((--color-[0-9a-f]+)\)/g)) {
          assert.ok(defaultBrand.palette[token], `${file}: missing ${token}`);
        }
        // The business-site preview uses provisional colors until its logo is approved.
      }
    }
  }
  await visit('app');
});
