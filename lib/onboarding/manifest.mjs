// The onboarding manifest: ONE declarative list of everything a franchise has to hand over,
// each field tagged with a tier that decides how it travels and how it is stored.
//
//   Tier 0  PUBLIC     Already visible on the business's existing site/listings. Harvested with no login.
//   Tier 1  DELEGATED  Lives in the owner's files/systems. Admin signs in, grants access or drops files,
//                      reviews, confirms. Stored in ordinary RLS-protected rows.
//   Tier 2  SENSITIVE  Identity/financial secrets. Never imported. Typed by the person they belong to
//                      (owner on their own session, employees through a one-time link). Envelope-encrypted;
//                      the platform operator has no read path (see lib/server/envelope-vault.mjs).
import {
  validateSsn, validateEin, validateRouting, validateAccount, validateLicense,
  validateText, validatePhone, validateEmail, validateDate, maskLast4,
} from './validators.mjs';

export const TIER = Object.freeze({ PUBLIC: 0, DELEGATED: 1, SENSITIVE: 2 });
export const SUBJECT = Object.freeze({ BUSINESS: 'business', OWNER: 'owner', EMPLOYEE: 'employee' });

const f = (key, tier, subject, en, es, validate, extra = {}) =>
  Object.freeze({ key, tier, subject, label: { en, es }, validate, ...extra });

const text = validateText();

export const FRANCHISE_MANIFEST = Object.freeze({
  id: 'franchise-v1',
  fields: Object.freeze([
    // ---- Tier 0: harvest from what the public can already see ----
    f('business_dba', 0, 'business', 'Public business name', 'Nombre comercial público', text),
    f('business_phone', 0, 'business', 'Public phone', 'Teléfono público', validatePhone),
    f('business_email', 0, 'business', 'Public email', 'Correo público', validateEmail),
    f('business_address', 0, 'business', 'Public address', 'Dirección pública', validateText(200)),
    f('service_area', 0, 'business', 'Service area', 'Área de servicio', validateText(300)),
    f('services', 0, 'business', 'Services offered', 'Servicios ofrecidos', validateText(500)),
    f('hours', 0, 'business', 'Business hours', 'Horario', validateText(200)),

    // ---- Tier 1: owner grants / drops files, reviews, confirms ----
    f('legal_name', 1, 'business', 'Legal entity name', 'Nombre legal', text),
    f('franchise_agreement_date', 1, 'business', 'Franchise agreement date', 'Fecha del contrato de franquicia', validateDate),
    f('client_site_name', 1, 'business', 'Client site name', 'Nombre del sitio', text, { repeating: true }),
    f('client_site_address', 1, 'business', 'Client site address', 'Dirección del sitio', validateText(200), { repeating: true }),
    f('client_site_type', 1, 'business', 'Client site type', 'Tipo de sitio', text, { repeating: true }),
    f('employee_name', 1, 'employee', 'Employee name', 'Nombre del empleado', text),
    f('employee_phone', 1, 'employee', 'Employee phone', 'Teléfono del empleado', validatePhone),
    f('employee_email', 1, 'employee', 'Employee email', 'Correo del empleado', validateEmail),
    f('employee_hire_date', 1, 'employee', 'Hire date', 'Fecha de contratación', validateDate),
    f('employee_role', 1, 'employee', 'Role', 'Puesto', text),

    // ---- Tier 2: typed by the owner of the secret, encrypted, never imported ----
    f('owner_ssn', 2, 'owner', 'Owner SSN', 'SSN del propietario', validateSsn, { mask: (v) => maskLast4(v, '•••-••-'), blindIndex: true }),
    f('owner_license', 2, 'owner', 'Owner driver license / ID', 'Licencia/ID del propietario', validateLicense, { mask: (v) => maskLast4(v) }),
    f('business_ein', 2, 'business', 'Business EIN', 'EIN del negocio', validateEin, { mask: (v) => maskLast4(v, '••-•••'), blindIndex: true }),
    f('business_routing', 2, 'business', 'Business bank routing', 'Ruta bancaria del negocio', validateRouting, { mask: (v) => maskLast4(v) }),
    f('business_account', 2, 'business', 'Business bank account', 'Cuenta bancaria del negocio', validateAccount, { mask: (v) => maskLast4(v) }),
    f('employee_ssn', 2, 'employee', 'Employee SSN', 'SSN del empleado', validateSsn, { mask: (v) => maskLast4(v, '•••-••-'), blindIndex: true, employeeEntry: true }),
    f('employee_license', 2, 'employee', 'Employee driver license / ID', 'Licencia/ID del empleado', validateLicense, { mask: (v) => maskLast4(v), employeeEntry: true }),
    f('employee_routing', 2, 'employee', 'Direct deposit routing', 'Ruta de depósito directo', validateRouting, { mask: (v) => maskLast4(v), employeeEntry: true }),
    f('employee_account', 2, 'employee', 'Direct deposit account', 'Cuenta de depósito directo', validateAccount, { mask: (v) => maskLast4(v), employeeEntry: true }),
  ]),
});

const byKey = new Map(FRANCHISE_MANIFEST.fields.map((x) => [x.key, x]));
export const fieldDef = (key, manifest = FRANCHISE_MANIFEST) =>
  manifest === FRANCHISE_MANIFEST ? byKey.get(key) ?? null : manifest.fields.find((x) => x.key === key) ?? null;
export const fieldsByTier = (tier, manifest = FRANCHISE_MANIFEST) => manifest.fields.filter((x) => x.tier === tier);
export const employeeEntryFields = (manifest = FRANCHISE_MANIFEST) => manifest.fields.filter((x) => x.tier === 2 && x.employeeEntry).map((x) => x.key);

/** Validate + normalize one value against the manifest. Never echoes the input in errors. */
export function checkValue(key, raw, manifest = FRANCHISE_MANIFEST) {
  const def = fieldDef(key, manifest);
  if (!def) return { ok: false, error: 'unknown_field' };
  const r = def.validate(raw);
  return r.ok ? { ok: true, value: r.value, def } : r;
}
