import { UNSIGNED, formatNumber, inRange, operand, readNumber, working } from './format.mjs';
import { cannotCompute } from './i18n.mjs';

const words = {
  plus: '+', mas: '+', minus: '-', menos: '-', times: '*', por: '*',
  'divided by': '/', 'dividido por': '/', 'dividido entre': '/', entre: '/',
};
const wordPattern = /\b(?:divided by|dividido por|dividido entre|plus|mas|minus|menos|times|por|entre)\b/g;
const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', '%': '%' };

function tokenize(text, lang) {
  const source = text.replace(wordPattern, word => words[word]);
  const number = new RegExp(UNSIGNED, 'y');
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === ' ') {
      i++;
    } else if ('+-*/^%()'.includes(ch)) {
      tokens.push(ch);
      i++;
    } else {
      number.lastIndex = i;
      const match = number.exec(source);
      if (!match) return null;
      tokens.push(readNumber(match[0], lang));
      i = number.lastIndex;
    }
  }
  return tokens;
}

export function arithmetic(text, lang) {
  const tokens = tokenize(text, lang);
  if (!tokens?.length) return null;
  let i = 0;
  const steps = [];

  function combine(a, op, b) {
    if (!inRange(a) || !inRange(b)) return NaN;
    let value;
    switch (op) {
      case '+': value = a + b; break;
      case '-': value = a - b; break;
      case '*': value = a * b; break;
      case '/': value = a / b; break;
      case '%': value = a % b; break;
      case '^': value = Math.abs(b) <= 100 ? a ** b : NaN; break;
    }
    if (!inRange(value)) return NaN;
    const left = op === '^' && a < 0 ? `(${operand(a, lang)})` : operand(a, lang);
    const formula = `${left} ${symbols[op]} ${operand(b, lang)}`;
    steps.push(working(formula, value, lang));
    return value;
  }

  function factor(depth) {
    if (depth > 20) return NaN;
    const token = tokens[i++];
    if (token === '+') return factor(depth + 1);
    if (token === '-') return combine(0, '-', factor(depth + 1));

    let base;
    if (token === '(') {
      base = sum(depth + 1);
      if (tokens[i++] !== ')') return NaN;
    } else if (typeof token === 'number') {
      base = token;
    } else {
      return NaN;
    }
    // Power binds more tightly than a leading sign and is right-associative.
    if (tokens[i] !== '^') return base;
    i++;
    return combine(base, '^', factor(depth + 1));
  }

  function product(depth) {
    let value = factor(depth);
    while (tokens[i] === '*' || tokens[i] === '/' || tokens[i] === '%') {
      const op = tokens[i++];
      value = combine(value, op, factor(depth));
    }
    return value;
  }

  function sum(depth) {
    let value = product(depth);
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      value = combine(value, op, product(depth));
    }
    return value;
  }

  const value = sum(0);
  if (i !== tokens.length || !inRange(value)) return cannotCompute('arithmetic', lang);
  return { kind: 'answer', intent: 'arithmetic', text: formatNumber(value, lang), steps };
}
