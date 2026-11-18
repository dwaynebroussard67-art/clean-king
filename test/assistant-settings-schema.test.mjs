import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, parseSettings, settingsForPrompt } from '../lib/assistant-settings-schema.mjs';

const minimumUrl = 'https://model.example/';
const maxUrl = minimumUrl.padEnd(200, 'x');

function withField(path, value) {
  const input = structuredClone(DEFAULT_SETTINGS);
  const keys = path.split('.');
  const leaf = keys.pop();
  const parent = keys.reduce((object, key) => object[key], input);
  if (value === undefined) delete parent[leaf];
  else parent[leaf] = value;
  return input;
}

test('settings default to the exact disabled v1 contract', () => {
  const expected = {
    version: 1,
    enabled: false,
    persona: { name: 'Sparkle', ownerName: 'Andy', tone: 'bubbly', emoji: 'light', length: 'short' },
    voice: { speakReplies: false, rate: 1, pitch: 1, voiceName: null },
    capabilities: { counts: true, emailHealth: true },
    provider: {
      active: 'anthropic', anthropicModel: 'claude-sonnet-5-5', customBaseUrl: '',
      customModel: '', fallbackToCustom: false,
    },
    limits: { perMinute: 3, perMonth: 100, maxOutputTokens: 400, temperature: 0.4 },
  };
  assert.deepEqual(DEFAULT_SETTINGS, expected);
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), { ok: true, value: expected });
});

test('settings accept exact boundaries and trim only the persona names', () => {
  for (const [path, value] of [
    ['persona.name', 'Å'.repeat(40)], ['persona.ownerName', 'A'.repeat(60)],
    ['persona.name', '李'], ['provider.anthropicModel', 'a'.repeat(100)],
    ['provider.customModel', 'org/model:v2-3_4.5'], ['provider.customBaseUrl', maxUrl],
    ['voice.voiceName', 'x'.repeat(100)], ['voice.voiceName', ''],
    ['voice.rate', 0.5], ['voice.rate', 2], ['voice.pitch', 0], ['voice.pitch', 2],
    ['limits.perMinute', 1], ['limits.perMinute', 10],
    ['limits.perMonth', 1], ['limits.perMonth', 1000],
    ['limits.maxOutputTokens', 50], ['limits.maxOutputTokens', 800],
    ['limits.temperature', 0], ['limits.temperature', 1],
  ]) {
    const input = withField(path, value);
    assert.deepEqual(parseSettings(input), { ok: true, value: input }, path);
  }
  const input = structuredClone(DEFAULT_SETTINGS);
  input.persona.name = '  Brillo Ángel  ';
  input.persona.ownerName = '\tMaría O’Neill-2.\n';
  input.voice.voiceName = ' Windows voice ';
  const parsed = parseSettings(input);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.persona.name, 'Brillo Ángel');
  assert.equal(parsed.value.persona.ownerName, 'María O’Neill-2.');
  assert.equal(parsed.value.voice.voiceName, ' Windows voice ');
  assert.equal(input.persona.name, '  Brillo Ángel  ');
});

test('wrong types, unknown keys, formats and out-of-range values produce safe field errors', () => {
  for (const input of [null, undefined, [], false, 1, 'settings', {}]) {
    assert.equal(parseSettings(input).ok, false);
  }
  const invalid = [
    ['version', 0], ['version', '1'], ['version', undefined],
    ['enabled', 'false'], ['enabled', 0], ['enabled', undefined],
    ['persona', null], ['persona', []], ['persona', undefined],
    ['persona.name', ''], ['persona.name', ' \t '], ['persona.name', 'x'.repeat(41)],
    ['persona.name', 'Sparkle\nNext'], ['persona.name', '🙂'], ['persona.name', 3],
    ['persona.ownerName', ''], ['persona.ownerName', 'z'.repeat(61)],
    ['persona.ownerName', 'A/B'], ['persona.ownerName', null],
    ['persona.tone', 'casual'], ['persona.emoji', true], ['persona.emoji', 'many'],
    ['persona.length', 'long'], ['persona.length', undefined],
    ['voice', []], ['voice.speakReplies', 1], ['voice.speakReplies', 'true'],
    ['voice.rate', 0.49], ['voice.rate', 2.01], ['voice.rate', '1'],
    ['voice.pitch', -0.01], ['voice.pitch', 2.01], ['voice.pitch', NaN],
    ['voice.voiceName', 'x'.repeat(101)], ['voice.voiceName', 12], ['voice.voiceName', undefined],
    ['capabilities', []], ['capabilities.counts', 'true'], ['capabilities.counts', undefined],
    ['capabilities.emailHealth', 0], ['capabilities.emailHealth', null],
    ['provider', false], ['provider.active', 'openai'], ['provider.active', null],
    ['provider.anthropicModel', ''], ['provider.anthropicModel', 'x'.repeat(101)],
    ['provider.anthropicModel', 'model with spaces'], ['provider.anthropicModel', 'model\n'],
    ['provider.customModel', 'bad@model'], ['provider.customModel', 'm'.repeat(101)],
    ['provider.customModel', null], ['provider.customModel', undefined],
    ['provider.customBaseUrl', `${maxUrl}x`], ['provider.customBaseUrl', 'https://'],
    ['provider.customBaseUrl', 'http://localhost'], ['provider.customBaseUrl', 'file:///path'],
    ['provider.customBaseUrl', '//model.example'], ['provider.customBaseUrl', 'https://bad host'],
    ['provider.customBaseUrl', 'https://exa\nmple.test'], ['provider.customBaseUrl', 1],
    ['provider.fallbackToCustom', 'false'], ['provider.fallbackToCustom', undefined],
    ['limits', 'unlimited'], ['limits.perMinute', 0], ['limits.perMinute', 11],
    ['limits.perMinute', 1.1], ['limits.perMinute', true],
    ['limits.perMonth', 0], ['limits.perMonth', 1001], ['limits.perMonth', 99.5],
    ['limits.maxOutputTokens', 49], ['limits.maxOutputTokens', 801], ['limits.maxOutputTokens', 200.1],
    ['limits.temperature', -0.01], ['limits.temperature', 1.01],
    ['limits.temperature', Infinity], ['limits.temperature', '0.4'],
  ];
  for (const [path, value] of invalid) {
    const parsed = parseSettings(withField(path, value));
    assert.equal(parsed.ok, false, path);
    assert.ok(parsed.errors.some((error) => error.path === path && error.message.length > 0), path);
  }
  for (const path of ['', 'persona', 'voice', 'capabilities', 'provider', 'limits']) {
    const input = structuredClone(DEFAULT_SETTINGS);
    for (const key of ['synthetic-private-field', '__proto__']) {
      const target = path ? input[path] : input;
      Object.defineProperty(target, key, { value: 'synthetic-private-value', enumerable: true, configurable: true });
      const parsed = parseSettings(input);
      assert.equal(parsed.ok, false, path);
      assert.ok(parsed.errors.some((error) => error.path === path));
      assert.doesNotMatch(JSON.stringify(parsed.errors), /synthetic-private/);
      delete target[key];
    }
  }
});

test('prompt projection copies only known persona and capability fields', () => {
  const input = structuredClone(DEFAULT_SETTINGS);
  input.provider.customModel = 'private-model';
  input.capabilities.emailHealth = false;
  input.capabilities.extra = 'not-for-prompt';
  input.persona.extra = 'not-for-prompt';
  input.extra = 'not-for-prompt';
  const projection = settingsForPrompt(input);
  assert.deepEqual(projection, {
    persona: DEFAULT_SETTINGS.persona,
    capabilities: { counts: true, emailHealth: false },
  });
  projection.persona.name = 'Other';
  assert.equal(input.persona.name, 'Sparkle');
});
