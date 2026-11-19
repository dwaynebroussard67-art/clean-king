import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, parseSettings, settingsForPrompt } from '../lib/assistant-settings-schema.mjs';

const valid = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

test('defaults parse and settingsForPrompt excludes provider and limits', () => {
  const result = parseSettings(DEFAULT_SETTINGS);
  assert.equal(result.ok, true);
  assert.equal(result.value.persona.tone, 'friendly');
  assert.equal(result.value.enabled, false);
  assert.deepEqual(settingsForPrompt(result.value), {
    persona: result.value.persona,
    capabilities: result.value.capabilities,
  });
  assert.equal('provider' in settingsForPrompt(result.value), false);
  assert.equal('limits' in settingsForPrompt(result.value), false);
});

test('strict settings validation rejects malformed, out-of-range, and unknown values', () => {
  const bad = [
    (s) => { s.extra = true; },
    (s) => { s.enabled = 'true'; },
    (s) => { s.version = 2; },
    (s) => { s.persona.extra = 'x'; },
    (s) => { s.persona.name = ''; },
    (s) => { s.persona.name = 'x'.repeat(41); },
    (s) => { s.persona.name = 'Bad\nName'; },
    (s) => { s.persona.ownerName = ''; },
    (s) => { s.persona.ownerName = 'x'.repeat(61); },
    (s) => { s.persona.ownerName = 'Owner!'; },
    (s) => { s.persona.tone = 'flirty'; },
    (s) => { s.persona.emoji = 'many'; },
    (s) => { s.persona.length = 'long'; },
    (s) => { s.voice.speakReplies = 1; },
    (s) => { s.voice.rate = 0.49; },
    (s) => { s.voice.rate = 2.01; },
    (s) => { s.voice.pitch = -0.01; },
    (s) => { s.voice.pitch = 2.01; },
    (s) => { s.voice.voiceName = 'x'.repeat(101); },
    (s) => { s.capabilities.counts = 'yes'; },
    (s) => { s.capabilities.emailHealth = null; },
    (s) => { s.provider.active = 'openai'; },
    (s) => { s.provider.anthropicModel = ''; },
    (s) => { s.provider.anthropicModel = 'model with spaces'; },
    (s) => { s.provider.customModel = 'model with spaces'; },
    (s) => { s.provider.customBaseUrl = 'http://example.com'; },
    (s) => { s.provider.customBaseUrl = 'https://x'.repeat(30); },
    (s) => { s.provider.fallbackToCustom = 'true'; },
    (s) => { s.limits.perMinute = 0; },
    (s) => { s.limits.perMinute = 11; },
    (s) => { s.limits.perMinute = 1.5; },
    (s) => { s.limits.perMonth = 0; },
    (s) => { s.limits.perMonth = 1001; },
    (s) => { s.limits.perMonth = 1.1; },
    (s) => { s.limits.maxOutputTokens = 49; },
    (s) => { s.limits.maxOutputTokens = 801; },
    (s) => { s.limits.maxOutputTokens = 50.5; },
    (s) => { s.limits.temperature = -0.1; },
    (s) => { s.limits.temperature = 1.1; },
    (s) => { s.limits.temperature = '0.4'; },
  ];

  assert.ok(bad.length >= 40);
  for (const mutate of bad) {
    const value = valid();
    mutate(value);
    assert.equal(parseSettings(value).ok, false);
  }
});

test('validation errors are bilingual and do not reflect attacker-controlled key names', () => {
  const input = valid();
  Object.defineProperty(input, 'private-applicant-field', {
    value: 'must not be reflected', enumerable: true, configurable: true,
  });
  const parsed = parseSettings(input);
  assert.equal(parsed.ok, false);
  assert.doesNotMatch(JSON.stringify(parsed.errors), /private-applicant-field|must not be reflected/);
  assert.match(parsed.errors[0].message, / \/ /);
});

test('valid boundaries are accepted and trimmed names are returned', () => {
  const settings = valid();
  settings.persona.name = '  Sparkle  ';
  settings.persona.ownerName = '  Owner  ';
  settings.voice.rate = 0.5;
  settings.voice.pitch = 2;
  settings.provider.customModel = 'model-1';
  settings.limits.perMinute = 10;
  settings.limits.perMonth = 1000;
  settings.limits.maxOutputTokens = 800;
  settings.limits.temperature = 1;
  const parsed = parseSettings(settings);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.persona.name, 'Sparkle');
  assert.equal(parsed.value.persona.ownerName, 'Owner');
});
