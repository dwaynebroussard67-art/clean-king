'use server';

import { redirect } from 'next/navigation';
import { parseSettings } from '../../../../lib/assistant-settings-schema.mjs';
import { getAuthorizedAssistantContext } from '../../../../lib/server/owner-assistant-access.js';
import { validateCustomBaseUrl } from '../../../../lib/ai/index.mjs';

const SETTINGS_PATH = '/owner/assistant/settings';

export async function saveAssistantSettings(form) {
  const context = await getAuthorizedAssistantContext();
  if (!context) redirect('/owner/login');
  const current = await context.store.load();
  const value = formSettings(form);
  const parsed = parseSettings(value);
  if (!parsed.ok) redirect(`${SETTINGS_PATH}?state=invalid`);
  if (parsed.value.provider.customBaseUrl) {
    const checked = validateCustomBaseUrl(parsed.value.provider.customBaseUrl, {
      allowLocal: process.env.AI_ALLOW_LOCAL_CUSTOM === 'true' && process.env.NODE_ENV !== 'production',
    });
    if (!checked.ok) redirect(`${SETTINGS_PATH}?state=invalid`);
  }
  const expectedVersion = Number(form.get('expectedVersion'));
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== current.version) {
    redirect(`${SETTINGS_PATH}?state=conflict`);
  }
  const result = await context.store.save(parsed.value, expectedVersion);
  if (result.result === 'conflict') redirect(`${SETTINGS_PATH}?state=conflict`);
  if (result.result !== 'ok') redirect(`${SETTINGS_PATH}?state=invalid`);
  redirect(`${SETTINGS_PATH}?state=saved`);
}

export async function saveAssistantSecret(form) {
  const context = await getAuthorizedAssistantContext();
  if (!context) redirect('/owner/login');
  const name = String(form.get('name') ?? '');
  const value = String(form.get('value') ?? '');
  let state;
  try {
    const saved = await context.store.setSecret(name, value);
    state = saved ? 'secret-saved' : 'secret-invalid';
  } catch (error) {
    state = error?.message === 'encryption_not_ready' ? 'encryption-not-ready' : 'secret-invalid';
  }
  redirect(`${SETTINGS_PATH}?state=${state}`);
}

export async function removeAssistantSecret(form) {
  const context = await getAuthorizedAssistantContext();
  if (!context) redirect('/owner/login');
  const name = String(form.get('name') ?? '');
  const removed = await context.store.clearSecret(name);
  redirect(`${SETTINGS_PATH}?state=${removed ? 'secret-removed' : 'secret-unset'}`);
}

function formSettings(form) {
  return {
    version: 1,
    enabled: form.get('enabled') === 'on',
    persona: {
      name: String(form.get('personaName') ?? ''),
      ownerName: String(form.get('ownerName') ?? ''),
      tone: String(form.get('tone') ?? ''),
      emoji: String(form.get('emoji') ?? ''),
      length: String(form.get('length') ?? ''),
    },
    voice: {
      speakReplies: form.get('speakReplies') === 'on',
      rate: Number(form.get('rate')),
      pitch: Number(form.get('pitch')),
      voiceName: String(form.get('voiceName') ?? '') || null,
    },
    capabilities: {
      counts: form.get('counts') === 'on',
      emailHealth: form.get('emailHealth') === 'on',
    },
    provider: {
      active: String(form.get('active') ?? ''),
      anthropicModel: String(form.get('anthropicModel') ?? ''),
      customBaseUrl: String(form.get('customBaseUrl') ?? ''),
      customModel: String(form.get('customModel') ?? ''),
      fallbackToCustom: form.get('fallbackToCustom') === 'on',
    },
    limits: {
      perMinute: Number(form.get('perMinute')),
      perMonth: Number(form.get('perMonth')),
      maxOutputTokens: Number(form.get('maxOutputTokens')),
      temperature: Number(form.get('temperature')),
    },
  };
}
