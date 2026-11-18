import { z } from 'zod';

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: false,
  persona: Object.freeze({
    name: 'Sparkle', ownerName: 'Andy', tone: 'bubbly', emoji: 'light', length: 'short',
  }),
  voice: Object.freeze({ speakReplies: false, rate: 1, pitch: 1, voiceName: null }),
  capabilities: Object.freeze({ counts: true, emailHealth: true }),
  provider: Object.freeze({
    active: 'anthropic',
    anthropicModel: 'claude-sonnet-5-5',
    customBaseUrl: '',
    customModel: '',
    fallbackToCustom: false,
  }),
  limits: Object.freeze({ perMinute: 3, perMonth: 100, maxOutputTokens: 400, temperature: 0.4 }),
});

const name = (max) => z.string().trim().min(1).max(max).regex(/^[\p{L}\p{N} '’.-]+$/u);
const model = z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/);

// Syntax only; the provider layer checks whether a URL is safe to contact.
function httpsUrlOrEmpty(value) {
  if (value === '') return true;
  if (!value.startsWith('https://') || /[\s\x00-\x1f\x7f]/u.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const schema = z.strictObject({
  version: z.literal(1),
  enabled: z.boolean(),
  persona: z.strictObject({
    name: name(40),
    ownerName: name(60),
    tone: z.enum(['bubbly', 'friendly', 'professional', 'concise']),
    emoji: z.enum(['none', 'light', 'lots']),
    length: z.enum(['short', 'normal', 'detailed']),
  }),
  voice: z.strictObject({
    speakReplies: z.boolean(),
    rate: z.number().min(0.5).max(2),
    pitch: z.number().min(0).max(2),
    voiceName: z.string().max(100).nullable(),
  }),
  capabilities: z.strictObject({ counts: z.boolean(), emailHealth: z.boolean() }),
  provider: z.strictObject({
    active: z.enum(['anthropic', 'custom']),
    anthropicModel: model,
    customBaseUrl: z.string().max(200).refine(httpsUrlOrEmpty),
    customModel: z.union([model, z.literal('')]),
    fallbackToCustom: z.boolean(),
  }),
  limits: z.strictObject({
    perMinute: z.number().int().min(1).max(10),
    perMonth: z.number().int().min(1).max(1000),
    maxOutputTokens: z.number().int().min(50).max(800),
    temperature: z.number().min(0).max(1),
  }),
});

// Do not forward Zod's input-dependent messages or unrecognized key names.
const messages = {
  invalid_type: 'Invalid value type. / Tipo de valor no válido.',
  invalid_value: 'Choose an allowed value. / Elige un valor permitido.',
  invalid_format: 'Invalid format. / Formato no válido.',
  unrecognized_keys: 'Unexpected fields. / Hay campos no reconocidos.',
  too_small: 'Below the allowed minimum. / Por debajo del mínimo permitido.',
  too_big: 'Above the allowed maximum. / Por encima del máximo permitido.',
  custom: 'Enter an HTTPS URL or leave it empty. / Ingresa una URL HTTPS o deja el campo vacío.',
};

export function parseSettings(input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(({ path, code }) => ({
      path: path.join('.'),
      message: messages[code] ?? 'Invalid value. / Valor no válido.',
    }));
    return { ok: false, errors };
  }
  // Reject this unknown JSON key even if the validator skips it for prototype safety.
  const paths = ['', 'persona', 'voice', 'capabilities', 'provider', 'limits'];
  const path = paths.find((key) => Object.hasOwn(key ? input[key] : input, '__proto__'));
  if (path !== undefined) {
    return { ok: false, errors: [{ path, message: messages.unrecognized_keys }] };
  }
  return { ok: true, value: parsed.data };
}

export function settingsForPrompt(settings) {
  const { name, ownerName, tone, emoji, length } = settings.persona;
  const { counts, emailHealth } = settings.capabilities;
  return {
    persona: { name, ownerName, tone, emoji, length },
    capabilities: { counts, emailHealth },
  };
}
