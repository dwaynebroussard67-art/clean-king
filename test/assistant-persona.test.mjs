import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS } from '../lib/assistant-settings-schema.mjs';

test('assistant persona defaults are neutral, friendly placeholders', () => {
  assert.equal(DEFAULT_SETTINGS.persona.tone, 'friendly');
  assert.equal(DEFAULT_SETTINGS.persona.name, 'Assistant');
  assert.equal(DEFAULT_SETTINGS.persona.ownerName, 'Owner');
  assert.equal(DEFAULT_SETTINGS.enabled, false);
});

test('owner chat renders configured names instead of hardcoded Andy copy', async () => {
  const source = await readFile(new URL('../app/owner/assistant/owner-chat.js', import.meta.url), 'utf8');
  assert.match(source, /personaName, ownerName/);
  assert.match(source, /t\.intro\(personaName, ownerName\)/);
  assert.doesNotMatch(source, /Hi Andy|Hola Andy/);
});
