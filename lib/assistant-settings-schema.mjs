import { z } from 'zod';

const PERSONA_NAME = /^[\p{L}\p{N} '’.-]+$/u;
const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,100}$/;

// PLACEHOLDER defaults pending owner approval. Keep owner access and provider use disabled by default.
export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: false,
  persona: Object.freeze({
    name: 'Assistant',
    ownerName: 'Owner',
    tone: 'friendly',
    emoji: 'light',
    length: 'short',
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

const trimmedName = (maximum) => z.string()
  .trim()
  .min(1)
  .max(maximum)
  .regex(PERSONA_NAME);

const settingsSchema = z.strictObject({
  version: z.literal(1),
  enabled: z.boolean(),
  persona: z.strictObject({
    name: trimmedName(40),
    ownerName: trimmedName(60),
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
    anthropicModel: z.string().regex(MODEL_NAME),
    customBaseUrl: z.union([
      z.literal(''),
      z.string().max(200).url().refine((value) => value.startsWith('https://')),
    ]),
    customModel: z.union([z.literal(''), z.string().regex(MODEL_NAME)]),
    fallbackToCustom: z.boolean(),
  }),
  limits: z.strictObject({
    perMinute: z.number().int().min(1).max(10),
    perMonth: z.number().int().min(1).max(1000),
    maxOutputTokens: z.number().int().min(50).max(800),
    temperature: z.number().min(0).max(1),
  }),
});

export function parseSettings(input) {
  const result = settingsSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export function settingsForPrompt(settings) {
  return {
    persona: {
      name: settings.persona.name,
      ownerName: settings.persona.ownerName,
      tone: settings.persona.tone,
      emoji: settings.persona.emoji,
      length: settings.persona.length,
    },
    capabilities: {
      counts: settings.capabilities.counts,
      emailHealth: settings.capabilities.emailHealth,
    },
  };
}
