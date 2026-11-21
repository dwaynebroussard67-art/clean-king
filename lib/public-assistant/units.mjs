import { SIGNED, formatNumber, inRange, operand, readNumber, timeAmount, working } from './format.mjs';
import { cannotCompute } from './i18n.mjs';

const names = {
  sqft: 'sq ft|sqft|ft2|ft²|square foot|square feet|pie cuadrado|pies cuadrados',
  sqm: 'sq m|sqm|m2|m²|square meter|square meters|square metre|square metres|metro cuadrado|metros cuadrados',
  mi: 'mi|mile|miles|milla|millas',
  km: 'km|kilometer|kilometers|kilometre|kilometres|kilometro|kilometros',
  gal: 'gal|gallon|gallons|us gal|us gallon|us gallons|gal (us)|galon|galones',
  L: 'l|liter|liters|litre|litres|litro|litros',
  lb: 'lb|lbs|pound|pounds|libra|libras',
  kg: 'kg|kilogram|kilograms|kilogramo|kilogramos|kilo|kilos',
  h: 'h|hr|hrs|hour|hours|hora|horas',
  min: 'min|mins|minute|minutes|minuto|minutos',
};
const aliases = new Map();
for (const [id, list] of Object.entries(names)) {
  for (const name of list.split('|')) aliases.set(name, id);
}

export function unitId(name) {
  return aliases.get(name.replace(/\./g, ''));
}

const pairs = [
  ['sqft', 'sqm', 0.09290304], ['mi', 'km', 1.609344],
  ['gal', 'L', 3.785411784], ['lb', 'kg', 0.45359237], ['h', 'min', 60],
];
const pattern = new RegExp(`^(?:convert |convierte |convertir )?(${SIGNED}) ?(.+?) (?:to|into|in|a|en) (.+)$`);

export function conversion(text, lang) {
  const match = pattern.exec(text);
  if (!match) return null;
  const from = unitId(match[2]);
  const to = unitId(match[3]);
  const pair = pairs.find(([a, b]) => (a === from && b === to) || (a === to && b === from));
  if (!pair) return null;

  const input = readNumber(match[1], lang);
  const multiply = pair[0] === from;
  const factor = pair[2];
  const value = multiply ? input * factor : input / factor;
  if (!inRange(input) || !inRange(value)) return cannotCompute('conversion', lang);
  const symbols = lang === 'es'
    ? { sqft: 'ft²', sqm: 'm²', gal: 'gal (EE. UU.)' }
    : { sqft: 'sq ft', sqm: 'sq m', gal: 'US gal' };
  const quantity = to === 'h' || to === 'min'
    ? timeAmount(value, to === 'h' ? 'hour' : 'minute', lang)
    : `${formatNumber(value, lang)} ${symbols[to] ?? to}`;
  const formula = `${operand(input, lang)} ${multiply ? '×' : '÷'} ${operand(factor, lang)}`;
  return { kind: 'answer', intent: 'conversion', text: quantity, steps: [working(formula, value, lang)] };
}
