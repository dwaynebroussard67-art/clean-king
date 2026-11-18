import { SIGNED, formatNumber, inRange, operand, readNumber, timeAmount, working } from './format.mjs';
import { cannotCompute } from './i18n.mjs';
import { EXAMPLE_SQFT_PER_CLEANER_HOUR, EXAMPLE_WEEKLY_CAP_HOURS } from './rates.mjs';
import { unitId } from './units.mjs';

const percentOf = new RegExp(`^(?:el )?(${SIGNED}) ?(?:%|percent|por ciento) (?:of|de) (${SIGNED})$`);
const whatPercent = new RegExp(
  `^(?:what percent(?:age)? is|que porcentaje (?:es|representa)) (${SIGNED}) (?:of|de) (${SIGNED})$`,
);

export function percent(text, lang) {
  const of = percentOf.exec(text);
  const match = of ?? whatPercent.exec(text);
  if (!match) return null;
  const a = readNumber(match[1], lang);
  const b = readNumber(match[2], lang);
  const value = of ? (a / 100) * b : (a / b) * 100;
  if (![a, b, value].every(inRange)) return cannotCompute('percent', lang);
  const x = operand(a, lang);
  const y = operand(b, lang);
  const formula = of
    ? `${x}% × ${y} = ${operand(a / 100, lang)} × ${y}`
    : `(${x} ÷ ${y}) × 100`;
  return {
    kind: 'answer', intent: 'percent', text: formatNumber(value, lang) + (of ? '' : '%'),
    steps: [working(formula, value, lang)],
  };
}

const clock = String.raw`(\d{1,2})(?::(\d{2}))?(?: ?([ap])\.? ?m\.?)?`;
const shiftPattern = new RegExp(`^(?:from |(?:de|desde) (?:las )?)?${clock} (?:to|a|hasta) (?:las )?${clock}$`);

function minutes(h, m, meridiem) {
  let hour = Number(h);
  const minute = Number(m ?? 0);
  if (minute > 59 || hour > 23) return NaN;
  if (meridiem) {
    if (hour < 1 || hour > 12) return NaN;
    hour = hour % 12 + (meridiem === 'p' ? 12 : 0);
  }
  return hour * 60 + minute;
}

export function shift(text, lang) {
  const match = shiftPattern.exec(text);
  if (!match) return null;
  const start = minutes(match[1], match[2], match[3]);
  const end = minutes(match[4], match[5], match[6]);
  if (![start, end].every(Number.isFinite)) return cannotCompute('shift', lang);
  const wrap = end < start ? 24 * 60 : 0;
  const span = end + wrap - start;
  const parts = [];
  if (span >= 60 || span === 0) parts.push(timeAmount(Math.floor(span / 60), 'hour', lang));
  if (span % 60) parts.push(timeAmount(span % 60, 'minute', lang));
  const formula = `${operand(end, lang)} − ${operand(start, lang)}${wrap ? ` + ${operand(wrap, lang)}` : ''}`;
  return {
    kind: 'answer', intent: 'shift', text: parts.join(lang === 'es' ? ' y ' : ' and '),
    steps: [working(formula, span, lang) + ' min'],
  };
}

const hourUnit = '(?:hours?|horas?|hrs?|h)';
const weeklyPattern = new RegExp(
  `^(${SIGNED}) ${hourUnit} (?:plus|mas|\\+) (?:an? |un turno de )?(${SIGNED})[ -]${hourUnit}(?: shift)?$`,
);

export function weekly(text, lang) {
  const match = weeklyPattern.exec(text);
  if (!match) return null;
  const prior = readNumber(match[1], lang);
  const extra = readNumber(match[2], lang);
  const total = prior + extra;
  if (![prior, extra, total].every(inRange) || prior < 0 || extra < 0) return cannotCompute('weekly', lang);
  const cap = timeAmount(EXAMPLE_WEEKLY_CAP_HOURS, 'hour', lang);
  const delta = total - EXAMPLE_WEEKLY_CAP_HOURS;
  const gap = timeAmount(Math.abs(delta), 'hour', lang);
  const sum = timeAmount(total, 'hour', lang);
  let comparison;
  if (lang === 'es') {
    comparison = delta === 0 ? 'justo en el límite' : `${gap} ${delta > 0 ? 'por encima' : 'por debajo'}`;
    comparison = `${sum} en total: ${comparison} (límite de ejemplo: ${cap}).`;
  } else {
    comparison = delta === 0 ? 'at the cap' : `${delta > 0 ? 'over' : 'under'} by ${gap}`;
    comparison = `${sum} total: ${comparison} (example cap: ${cap}).`;
  }
  const formula = `${operand(prior, lang)} + ${operand(extra, lang)}`;
  return { kind: 'answer', intent: 'weekly', text: comparison, steps: [working(formula, total, lang) + ' h'] };
}

const laborPattern = new RegExp(
  `^(?:(?:how many )?hours for|(?:cuantas )?horas para(?: limpiar)?) (${SIGNED}) ?(.+?) ` +
  `(?:with|con) (${SIGNED}) (?:cleaners?|(?:limpiador|trabajador)(?:a|es|as)?|personas?(?: de limpieza)?)$`,
);

export function labor(text, lang) {
  const match = laborPattern.exec(text);
  if (!match || unitId(match[2]) !== 'sqft') return null;
  const area = readNumber(match[1], lang);
  const crew = readNumber(match[3], lang);
  if (![area, crew].every(inRange) || area < 0 || !Number.isInteger(crew) || crew < 1) {
    return cannotCompute('labor', lang);
  }
  const rate = EXAMPLE_SQFT_PER_CLEANER_HOUR;
  const elapsed = area / (rate * crew);
  const duration = timeAmount(elapsed, 'hour', lang);
  const formula = `${operand(area, lang)} ÷ (${operand(rate, lang)} × ${operand(crew, lang)})`;
  const es = lang === 'es';
  return {
    kind: 'answer', intent: 'labor',
    text: es ? `Estimación de ejemplo: ${duration}. No es una cotización ni un precio.`
      : `Example estimate: ${duration}. This is not a quote or price.`,
    steps: [
      es ? `Rendimiento de ejemplo: ${operand(rate, lang)} pies cuadrados por persona y hora.`
        : `Example rate: ${operand(rate, lang)} sq ft per cleaner per hour.`,
      working(formula, elapsed, lang) + ' h',
    ],
  };
}
