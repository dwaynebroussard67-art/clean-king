import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('employee referral page keeps disabled, sign-in, and access-denied messages bilingual', async () => {
  const source = await readFile(new URL('../app/crew/referrals/page.js', import.meta.url), 'utf8');
  for (const message of [
    'Employee referrals are not available yet. / Las referencias de empleados aún no están disponibles.',
    'Sign in with your employee account to continue. / Inicia sesión con tu cuenta de empleado para continuar.',
    'Access is limited to active, approved test employees. / El acceso está limitado a empleados de prueba activos y aprobados.',
  ]) assert.ok(source.includes(message), `missing bilingual fallback: ${message}`);
  assert.doesNotMatch(source, /<h1>Employee referrals<\/h1>|Access is limited to active, approved test employees\.<\/p>/);
});

test('referral page fails closed on auth, membership, and totals lookup errors', async () => {
  const source = await readFile(new URL('../app/crew/referrals/page.js', import.meta.url), 'utf8');
  assert.match(source, /catch \{\s*client = null;/);
  assert.match(source, /catch \{\s*user = null;/);
  assert.match(source, /catch \{\s*member = null;/);
  assert.match(source, /catch \{\s*totalsError = new Error\('totals_unavailable'\);/);
});
