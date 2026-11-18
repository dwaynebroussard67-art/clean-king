import { faq } from './faq.mjs';
import { MAX_INPUT } from './format.mjs';
import { copy } from './i18n.mjs';
import { labor, percent, shift, weekly } from './intents.mjs';
import { arithmetic } from './parser.mjs';
import { conversion } from './units.mjs';

export function answer(input, { lang = 'en' } = {}) {
  const language = lang === 'es' ? 'es' : 'en';
  const unknown = { kind: 'unknown', intent: null, text: copy[language].unknown };
  if (typeof input !== 'string') return unknown;
  // Bound all matching work, and never answer a truncated fragment of a question.
  const sample = input.slice(0, 500);
  if (sample.length > MAX_INPUT) return unknown;
  const text = sample.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[’‘]/g, "'").replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/')
    .trim().replace(/^¿|\?$/g, '').trim().replace(/\s+/g, ' ');
  const question = text.replace(/^(?:what is|what's|calculate|cuanto es|cuanto son|calcula) /, '');
  return arithmetic(question, language)
    ?? percent(question, language)
    ?? conversion(question, language)
    ?? shift(question, language)
    ?? weekly(question, language)
    ?? labor(question, language)
    ?? faq(text, language)
    ?? unknown;
}
