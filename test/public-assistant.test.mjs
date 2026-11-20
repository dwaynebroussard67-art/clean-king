import test from 'node:test';
import assert from 'node:assert/strict';
import { answer } from '../lib/public-assistant/engine.mjs';
import { copy } from '../lib/public-assistant/i18n.mjs';

const ask = (input, lang = 'en') => answer(input, { lang });

test('both interfaces offer the same controls and four working examples', () => {
  assert.deepEqual(Object.keys(copy.en).sort(), Object.keys(copy.es).sort());
  for (const lang of ['en', 'es']) {
    const intents = copy[lang].examples.map(question => ask(question, lang).intent);
    assert.deepEqual(intents, ['arithmetic', 'percent', 'conversion', 'shift']);
  }
});

const golden = [
  ['12*(3+4)', '12*(3+4)', '84', '84', 'arithmetic'],
  ['15% of 240', '15 por ciento de 240', '36', '36', 'percent'],
  ['500 sq ft to sq m', '500 pies cuadrados a metros cuadrados', '46.45 sq m', '46,45 m²', 'conversion'],
  ['6pm to 10pm', '6 p. m. a 10 p. m.', '4 hours', '4 horas', 'shift'],
  ['22:00 to 06:00', '22:00 a 06:00', '8 hours', '8 horas', 'shift'],
  ['hours for 5000 sq ft with 2 cleaners', 'horas para 5000 pies cuadrados con 2 limpiadores',
    'Example estimate: 2.5 hours. This is not a quote or price.',
    'Estimación de ejemplo: 2,5 horas. No es una cotización ni un precio.', 'labor'],
];

test('golden questions return localized answers and show their working', () => {
  for (const [en, es, enText, esText, intent] of golden) {
    for (const [input, lang, text] of [[en, 'en', enText], [es, 'es', esText]]) {
      const result = ask(input, lang);
      assert.equal(result.kind, 'answer', input);
      assert.equal(result.intent, intent, input);
      assert.equal(result.text, text, input);
      assert.ok(result.steps.length > 0, input);
    }
  }
  assert.deepEqual(ask('12*(3+4)').steps, ['3 + 4 = 7', '12 × 7 = 84']);
  assert.deepEqual(ask('15% of 240').steps, ['15% × 240 = 0.15 × 240 = 36']);
  assert.match(ask('500 sq ft to sq m').steps[0], /0\.09290304/);
});

test('arithmetic operators, precedence, words, decimals and grouping', () => {
  for (const [input, text, lang] of [
    ['10 minus 12 divided by 3 plus 2 times 4', '14'], ['17 % 5', '2'],
    ['2^3^2', '512'], ['-2^2', '-4'], ['(-2)^2', '4'], ['2^-2', '0.25'],
    ['¿Cuánto es 6 entre 2 por 3 menos 1,5 más 0,5?', '8', 'es'],
    ['1234 + .50', '1,234.5'], ['1234 más ,50', '1.234,5', 'es'],
    ['1/3', '0.33'], ['-0.0001', '0'], ['1^100', '1'], ['10^12', '1,000,000,000,000'],
    ['('.repeat(20) + '1' + ')'.repeat(20), '1'],
  ]) assert.equal(ask(input, lang).text, text, input);
});

test('invalid arithmetic and golden failures stay within the numeric and nesting bounds', () => {
  for (const input of [
    '1/0', '2^1000', '1^-101', '(-1)^0.5', '1%0', '(1/0)^0', '2^100', '1000000000001-1',
    '('.repeat(21) + '1' + ')'.repeat(21), '1+', '1 2', '(1+2', '1+2)', '1.2.3', '2(3)',
  ]) {
    for (const [lang, text] of [['en', "I can't compute that."], ['es', 'No puedo calcular eso.']]) {
      assert.deepEqual(ask(input, lang), { kind: 'unknown', intent: 'arithmetic', text }, input);
    }
  }
});

test('percent of a base and inverse percentage', () => {
  assert.equal(ask('what percent is 30 of 120').text, '25%');
  assert.equal(ask('¿Qué porcentaje representa 30 de 120?', 'es').text, '25%');
  assert.equal(ask('0,5% de 200', 'es').text, '1');
  assert.equal(ask('what percent is 5 of 0').kind, 'unknown');
});

test('all five unit pairs use the exact factor in both directions', () => {
  for (const [input, text, lang] of [
    ['1 sq ft to sq m', '0.09 sq m'], ['0.09290304 sq m to sq ft', '1 sq ft'],
    ['10 miles to km', '16.09 km'], ['1,609344 kilómetros a millas', '1 mi', 'es'],
    ['2 US gallons to liters', '7.57 L'], ['3,785411784 litros a galones', '1 gal (EE. UU.)', 'es'],
    ['2 pounds to kg', '0.91 kg'], ['0.45359237 kg to lb', '1 lb'],
    ['2.5 hours to minutes', '150 minutes'], ['90 minutos a horas', '1,5 horas', 'es'],
  ]) assert.equal(ask(input, lang).text, text, input);
  assert.equal(ask('2 kg to miles').kind, 'unknown');
  assert.equal(ask('1000000000000 hours to minutes').kind, 'unknown');
});

test('shift arithmetic distinguishes noon and midnight and rejects impossible times', () => {
  assert.equal(ask('from 22:00 to 06:00').text, '8 hours');
  assert.equal(ask('12am to 12pm').text, '12 hours');
  assert.equal(ask('11:45pm to 1:15am').text, '1 hour and 30 minutes');
  assert.equal(ask('de las 23:50 a las 00:10', 'es').text, '20 minutos');
  assert.equal(ask('06:00 to 06:00').text, '0 hours');
  for (const input of ['0am to 5am', '24:00 to 06:00', '12:60 to 14:00', '13pm to 5pm']) {
    assert.equal(ask(input).kind, 'unknown', input);
  }
});

test('weekly cap and productivity are examples, never prices or staffing decisions', () => {
  assert.match(ask('38 hours plus a 4 hour shift').text, /42 hours total: over by 2 hours \(example cap: 40 hours\)/);
  assert.match(ask('32 hours plus a 4-hour shift').text, /36 hours total: under by 4 hours/);
  assert.match(ask('36 hours plus a 4 hour shift').text, /40 hours total: at the cap/);
  assert.match(ask('38 horas más un turno de 4 horas', 'es').text, /42 horas en total: 2 horas por encima/);
  assert.equal(ask('hours for 2000 sq ft with 0 cleaners').kind, 'unknown');
  assert.equal(ask('hours for 2000 sq ft with 1.5 cleaners').kind, 'unknown');
  assert.equal(ask('hours for -2 sq ft with 1 cleaner').kind, 'unknown');
  assert.equal(ask('-2 hours plus a 4 hour shift').kind, 'unknown');
  assert.match(ask('hours for 2500 sq ft with 1 cleaner').steps[0], /Example rate: 1,000 sq ft/);
});

test('FAQ and unknown menu are fixed, bilingual and limited to public facts', () => {
  for (const [en, es, intent, expectEn, expectEs] of [
    ['How do I apply?', '¿Cómo solicito empleo?', 'faq.apply', /\/apply$/, /\/apply$/],
    ['Request a quote', 'Solicitar una cotización', 'faq.quote', /\/quote$/, /\/quote$/],
    ['Languages supported?', '¿Qué idiomas admite?', 'faq.languages', /English and Spanish/, /inglés y español/],
    ['What can this helper do?', '¿Qué puedes hacer?', 'faq.help', /calculate/, /calcular/],
  ]) {
    for (const [input, lang, pattern] of [[en, 'en', expectEn], [es, 'es', expectEs]]) {
      const result = ask(input, lang);
      assert.equal(result.intent, intent);
      assert.match(result.text, pattern);
    }
  }
  for (const input of ['service area', 'pricing', 'business hours']) {
    assert.equal(ask(input).text, 'The owner will confirm this — please use the quote form: /quote');
  }
  for (const input of ['área de servicio', 'precios', 'horarios']) {
    assert.match(ask(input, 'es').text, /^El dueño lo confirmará.*\/quote$/);
  }
  for (const lang of ['en', 'es']) {
    const result = ask('🪐', lang);
    assert.equal(result.kind, 'unknown');
    assert.equal(result.intent, null);
    assert.match(result.text, /\n• /);
    assert.deepEqual(ask('', lang), result);
  }
});
