// Validators + normalizers for onboarding values. Pure functions, no I/O.
// Each returns { ok: true, value } (normalized) or { ok: false, error } (a stable code, never the input).

const digits = (v) => (typeof v === 'string' ? v.replace(/[\s.-]/g, '') : '');
const fail = (error) => ({ ok: false, error });

export function validateSsn(input) {
  const d = digits(input);
  if (!/^\d{9}$/.test(d)) return fail('ssn_format');
  const area = d.slice(0, 3), group = d.slice(3, 5), serial = d.slice(5);
  if (area === '000' || area === '666' || area[0] === '9' || group === '00' || serial === '0000') return fail('ssn_invalid');
  return { ok: true, value: d };
}

export function validateEin(input) {
  const d = digits(input);
  if (!/^\d{9}$/.test(d) || d.startsWith('00')) return fail('ein_format');
  return { ok: true, value: d };
}

// ABA routing numbers carry a 3-7-1 weighted checksum.
export function validateRouting(input) {
  const d = digits(input);
  if (!/^\d{9}$/.test(d)) return fail('routing_format');
  const n = [...d].map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0 ? { ok: true, value: d } : fail('routing_checksum');
}

export function validateAccount(input) {
  const d = digits(input);
  return /^\d{4,17}$/.test(d) ? { ok: true, value: d } : fail('account_format');
}

export function validateLicense(input) {
  if (typeof input !== 'string') return fail('license_format');
  const v = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{5,20}$/.test(v) ? { ok: true, value: v } : fail('license_format');
}

export function validateText(max = 120) {
  return (input) => {
    if (typeof input !== 'string') return fail('text_format');
    const v = input.normalize('NFC').trim();
    return v.length >= 1 && v.length <= max ? { ok: true, value: v } : fail('text_length');
  };
}

export function validatePhone(input) {
  if (typeof input !== 'string') return fail('phone_format');
  let d = input.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 && d[0] !== '0' && d[0] !== '1' ? { ok: true, value: d } : fail('phone_format');
}

export function validateEmail(input) {
  if (typeof input !== 'string') return fail('email_format');
  const v = input.trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? { ok: true, value: v } : fail('email_format');
}

export function validateDate(input) {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return fail('date_format');
  const d = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(input) ? { ok: true, value: input } : fail('date_format');
}

// Display masks. They reveal at most the last four characters and never anything for short values.
export function maskLast4(value, prefix = '••••') {
  const s = String(value);
  return s.length < 8 ? '••••' : `${prefix}${s.slice(-4)}`;
}

export function luhnValid(numberString) {
  const d = digits(numberString);
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}
