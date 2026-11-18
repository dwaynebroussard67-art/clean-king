// Opaque cursors contain only an already-visible timestamp and record ID, never applicant details.
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function encodeCursor(record) {
  if (!record || typeof record.created_at !== 'string' || !timestamp.test(record.created_at) || !Number.isFinite(Date.parse(record.created_at)) || typeof record.id !== 'string' || !uuid.test(record.id)) return null;
  return Buffer.from(JSON.stringify([record.created_at,record.id])).toString('base64url');
}
export function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes=Buffer.from(value,'base64url');
    if(bytes.toString('base64url')!==value) return null;
    const pair=JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(pair) || pair.length!==2) return null;
    const record={created_at:pair[0],id:pair[1]};
    return encodeCursor(record) ? record : null;
  } catch { return null; }
}
// Inputs have already been restricted to timestamp/UUID alphabets; neither can inject PostgREST operators.
export function beforeFilter(cursor) {
  if(!cursor || !encodeCursor(cursor)) return null;
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}
export function ownerPageLink(kind, cursor, currentApps, currentLeads) {
  if (kind !== 'apps' && kind !== 'leads') throw new Error('Invalid section');
  const query=new URLSearchParams();
  const apps=kind==='apps'?cursor:currentApps;
  const leads=kind==='leads'?cursor:currentLeads;
  if(apps && decodeCursor(apps))query.set('apps',apps);
  if(leads && decodeCursor(leads))query.set('leads',leads);
  return `/owner${query.size?'?'+query.toString():''}`;
}
