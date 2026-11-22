// Tier-1 import with a Tier-2 guard.
// Owners will drop spreadsheets ("employee roster.csv") that contain a Social Security column.
// This module maps what we want and QUARANTINES what we must never put in an ordinary table:
// the sensitive values are dropped, counted, and reported to the owner, who is then offered the
// one-time-link flow for that data instead.
import { luhnValid } from './validators.mjs';
import { checkValue } from './manifest.mjs';

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SENSITIVE_HEADER = /\b(ssn|social|sin|tax id|taxpayer|itin|ein|dl|driver|license|licence|routing|aba|account|acct|bank|card|cvv|dob|birth)\b/;
const SSN_VALUE = /^\d{3}-\d{2}-\d{4}$/;

const SYNONYMS = {
  employee_name: ['name', 'full name', 'employee', 'employee name', 'worker'],
  employee_phone: ['phone', 'cell', 'mobile', 'phone number', 'cell phone'],
  employee_email: ['email', 'e mail', 'email address'],
  employee_hire_date: ['hire date', 'start date', 'date hired', 'started'],
  employee_role: ['role', 'position', 'title', 'job'],
  client_site_name: ['site', 'site name', 'client', 'building', 'location name'],
  client_site_address: ['address', 'site address', 'street address'],
  client_site_type: ['type', 'site type', 'building type'],
};

export function classifyValue(v) {
  const s = String(v ?? '').trim();
  if (SSN_VALUE.test(s)) return 'ssn_like_value';
  if (/^\d[\d -]{11,22}\d$/.test(s) && luhnValid(s)) return 'card_like_value';
  return null;
}

/**
 * @param {string} csvText
 * @param {'employee'|'client_site'} section  which manifest fields to map to
 * @returns {{ rows: object[], mapped: Record<string,string>, unmapped: string[],
 *             quarantined: {column:string, reason:string, count:number}[], rejected: {row:number, field:string, error:string}[] }}
 */
export function importCsv(csvText, section) {
  const table = parseCsv(csvText);
  if (table.length < 2) return { rows: [], mapped: {}, unmapped: [], quarantined: [], rejected: [] };
  const headers = table[0].map((h) => h.trim());
  const body = table.slice(1);
  const prefix = section === 'employee' ? 'employee_' : 'client_site_';

  const quarantine = new Map(); // column index -> reason
  headers.forEach((h, i) => {
    if (SENSITIVE_HEADER.test(norm(h))) quarantine.set(i, 'sensitive_header');
  });
  body.forEach((r) => r.forEach((cell, i) => {
    if (!quarantine.has(i) && classifyValue(cell)) quarantine.set(i, classifyValue(cell));
  }));

  const mapped = {}, unmapped = [];
  headers.forEach((h, i) => {
    if (quarantine.has(i)) return;
    const key = Object.keys(SYNONYMS).find((k) => k.startsWith(prefix) && SYNONYMS[k].includes(norm(h)));
    if (key && !Object.values(mapped).includes(i)) mapped[key] = i; else unmapped.push(h);
  });

  const rows = [], rejected = [];
  body.forEach((r, ri) => {
    const out = {};
    for (const [key, i] of Object.entries(mapped)) {
      const raw = (r[i] ?? '').trim();
      if (raw === '') continue;
      const res = checkValue(key, raw);
      if (res.ok) out[key] = res.value; else rejected.push({ row: ri + 2, field: key, error: res.error });
    }
    if (Object.keys(out).length) rows.push(out);
  });

  const quarantined = [...quarantine].map(([i, reason]) => ({
    column: headers[i], reason,
    count: body.filter((r) => (r[i] ?? '').trim() !== '').length,
  }));
  return { rows, mapped: Object.fromEntries(Object.entries(mapped).map(([k, i]) => [k, headers[i]])), unmapped, quarantined, rejected };
}
