import { defaultBrand } from './brand.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = kind => `${defaultBrand.legacyIntakeStoragePrefix}:intake:v1:${kind}`;

// Store only an opaque random ID, never form data or a hash of personal information.
export function getRequestId(storage, kind, generate) {
  try {
    const existing = storage?.getItem(key(kind));
    if (existing && uuid.test(existing)) return existing;
  } catch { /* browsers may block session storage */ }
  const id = generate();
  try { storage?.setItem(key(kind), id); } catch { /* an in-memory ID still works until reload */ }
  return id;
}
export function clearRequestId(storage, kind, id) {
  try { if (storage?.getItem(key(kind)) === id) storage.removeItem(key(kind)); }
  catch { /* storage may be unavailable */ }
}
