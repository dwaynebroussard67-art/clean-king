export const MAX_INPUT = 200;
export const UNSIGNED = String.raw`(?:\d+(?:[.,]\d*)?|[.,]\d+)`;
export const SIGNED = `[+-]?${UNSIGNED}`;

export function readNumber(literal, lang) {
  return Number(lang === 'es' ? literal.replace(',', '.') : literal);
}

export function inRange(value) {
  return Number.isFinite(value) && Math.abs(value) <= 1e12;
}

const options = { useGrouping: 'always', maximumFractionDigits: 2 };
const formats = {
  en: new Intl.NumberFormat('en-US', options),
  es: new Intl.NumberFormat('es-ES', options),
};

export function formatNumber(value, lang) {
  return formats[lang].format(Math.abs(value) < 0.005 ? 0 : value);
}

// Keep exact operands (especially conversion factors) in the working.
export function operand(value, lang) {
  if (Number(value.toFixed(2)) === value) return formatNumber(value, lang);
  return lang === 'es' ? String(value).replace('.', ',') : String(value);
}

export function working(formula, value, lang) {
  const sign = Number(value.toFixed(2)) === value ? '=' : '≈';
  return `${formula} ${sign} ${formatNumber(value, lang)}`;
}

export function timeAmount(value, unit, lang) {
  const number = formatNumber(value, lang);
  const label = lang === 'es' ? (unit === 'hour' ? 'hora' : 'minuto') : unit;
  return `${number} ${label}${number === '1' || number === '-1' ? '' : 's'}`;
}
