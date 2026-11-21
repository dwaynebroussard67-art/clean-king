import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('owner inbox labels, actions, and empty/error states include English and Spanish', async () => {
  const source = await readFile(new URL('../app/owner/page.js', import.meta.url), 'utf8');
  for (const english of [
    'Access not approved.', 'Intake inbox.', 'The inbox could not be loaded.',
    'Applications', 'Quote requests', 'Employee invitation:',
    'Professional cleaning experience:', 'Hire & start onboarding',
    'Onboarding tasks are unavailable.', 'Waiting to retry', 'Older ',
  ]) assert.ok(source.includes(english), `expected English copy: ${english}`);
  for (const spanish of [
    'Acceso no aprobado.', 'Bandeja de solicitudes.', 'No se pudo cargar la bandeja.',
    'Solicitudes de empleo', 'Solicitudes de presupuesto', 'Invitación de empleado:',
    'Experiencia en limpieza profesional:', 'Contratar e iniciar incorporación',
    'Las tareas de incorporación no están disponibles.', 'Pendiente de reintento',
    'Más antiguas:',
  ]) assert.ok(source.includes(spanish), `expected Spanish copy: ${spanish}`);
  assert.match(source, /function shiftLabel\(value\) \{ return \(\{ days: 'Days \/ Días'/);
});
