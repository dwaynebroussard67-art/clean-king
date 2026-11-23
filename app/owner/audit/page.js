import { redirect } from 'next/navigation';
import Link from 'next/link';
import PublicHeader from '../../public/header';
import { ownerLoginEnabled, sessionClient } from '../../../lib/server/supabase';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';

function Bi({ en, es }) { return <>{en} / {es}</>; }
const short = (value) => (typeof value === 'string' && value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value ?? '—');
const detailsText = (details) => {
  try {
    const text = JSON.stringify(details ?? {});
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  } catch {
    return '[unprintable details]';
  }
};

/**
 * Owner audit view. Read-only, franchise-scoped by RLS (owns_organization), no data
 * beyond what the audit triggers record (status/clearance transitions, referral and
 * onboarding actions). Global emergency-stop events carry no organization and are
 * intentionally not listed here. Print-friendly via @media print rules in globals.css.
 */
export default async function Audit({ searchParams }) {
  if (!ownerLoginEnabled()) redirect('/owner/login');
  const client = await sessionClient();
  if (!client) redirect('/owner/login');
  const { data: { user } = {}, error } = await client.auth.getUser();
  if (error || !user) redirect('/owner/login');
  const params = await searchParams;

  const { data: memberships, error: mError } = await client
    .from('owner_memberships').select('organization_id, role, active')
    .eq('user_id', user.id).eq('active', true);
  if (mError || !memberships || memberships.length === 0) redirect('/not-approved');

  const orgIds = memberships.map((m) => m.organization_id);
  const { data: orgs } = await client
    .from('organizations').select('id, name, slug, status')
    .in('id', orgIds);
  if (!orgs || orgs.length === 0) redirect('/not-approved');
  const requestedOrg = typeof params.org === 'string' ? params.org : null;
  const selectedOrgId = requestedOrg && orgIds.includes(requestedOrg) && orgs.some((o) => o.id === requestedOrg)
    ? requestedOrg
    : (orgs.find((o) => o.status === 'active') ?? orgs[0]).id;
  const selectedOrg = orgs.find((o) => o.id === selectedOrgId);

  const { data: entries, error: auditError } = await client
    .from('audit_log')
    .select('id, created_at, action, entity_type, entity_id, actor_id, details')
    .eq('organization_id', selectedOrgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);

  return <div className="public-page audit-page"><PublicHeader/><main className="owner-main audit-main">
    <div className="owner-heading"><div>
      <div className="mini-label"><Bi en="OWNER WORKSPACE · AUDIT LOG" es="ESPACIO DEL PROPIETARIO · REGISTRO DE AUDITORÍA"/></div>
      <h1><Bi en="Audit log." es="Registro de auditoría."/></h1>
      <p className="public-intro"><Bi en={`Latest 100 events for ${selectedOrg?.name ?? 'this franchise'}. Read-only.`} es={`Últimos 100 eventos para ${selectedOrg?.name ?? 'esta franquicia'}. Solo lectura.`}/></p>
    </div><div className="owner-heading-actions no-print"><Link className="btn light" href={requestedOrg ? `/owner?org=${selectedOrgId}` : '/owner'}><Bi en="Back to inbox" es="Volver a la bandeja"/></Link><form action={signOut}><button className="btn light"><Bi en="Sign out" es="Cerrar sesión"/></button></form></div></div>
    <div className="inline-notice no-print"><Bi en="Applicant phone numbers and names never appear here — only status/clearance actions, referral and onboarding events." es="Aquí nunca aparecen números de teléfono ni nombres de solicitantes — solo acciones de estado/autorización y eventos de referencias e incorporación."/></div>
    {auditError
      ? <p className="form-error" role="alert"><Bi en="The audit log could not be loaded." es="No se pudo cargar el registro de auditoría."/></p>
      : <section className="owner-section audit-table-wrap" aria-label="Audit events">
          <table className="audit-table">
            <thead><tr><th><Bi en="When" es="Cuándo"/></th><th><Bi en="Action" es="Acción"/></th><th><Bi en="Entity" es="Entidad"/></th><th><Bi en="Actor" es="Actor"/></th><th><Bi en="Details" es="Detalles"/></th></tr></thead>
            <tbody>
              {(entries ?? []).length === 0
                ? <tr><td colSpan={5}><Bi en="No audit events for this franchise yet." es="Aún no hay eventos de auditoría para esta franquicia."/></td></tr>
                : (entries ?? []).map((entry) => <tr key={entry.id}>
                    <td>{new Date(entry.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</td>
                    <td>{entry.action}</td>
                    <td>{entry.entity_type} · {short(entry.entity_id)}</td>
                    <td>{short(entry.actor_id)}</td>
                    <td><code>{detailsText(entry.details)}</code></td>
                  </tr>)}
            </tbody>
          </table>
        </section>}
    <p className="muted no-print"><Bi en="Global administrative events (for example the emergency stop) are not shown on this franchise view." es="Los eventos administrativos globales (por ejemplo, el paro de emergencia) no se muestran en esta vista de franquicia."/></p>
  </main></div>;
}
