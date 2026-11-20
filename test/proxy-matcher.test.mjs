import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('session refresh matcher includes the owner assistant API and keeps responses private', async () => {
  const source = await readFile(new URL('../proxy.js', import.meta.url), 'utf8');
  assert.match(source, /matcher:\s*\[[^\]]*'\/api\/owner\/:path\*'/s);
  assert.match(source, /Cache-Control',\s*'private, no-store'/);
});
