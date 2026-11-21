import { redirect } from 'next/navigation';
import Link from 'next/link';
import PublicHeader from '../public/header';
import { ownerLoginEnabled, sessionClient } from '../../lib/server/supabase';
import { updateIntake, signOut } from './actions';
import { beforeFilter, decodeCursor, encodeCursor, ownerPageLink } from '../../lib/pagination.mjs';

export const dynamic = 'force-dynamic';

function Bi({ en, es }) { return <>{en} / {es}</>; }
function Action({ type, id, field, value, children }) {
  return <form action={updateIntake}><input type="hidden" name="type" value={type}/><input type="hidden" name="id" value={id}/><input type="hidden" name="field" value={field}/><input type="hidden" name="value" value={value}/><button className="btn light small">{children}</button></form>;
}

export default async function Owner({ searchParams }) {
  if (!ownerLoginEnabled()) redirect('/owner/login');
  const client = await sessionClient();
  if (!client) redirect('/owner/login');
  const { data: { user } = {}, error } = await client.auth.getUser();
  if (error || !user) redirect('/owner/login');
  const { data: membership, error: membershipError } = await client.from('owner_memberships')
    .select('user_id').eq('user_id', user.id).maybeSingle();
  if (membershipError || !membership) return <div className="public-page"><PublicHeader/><main className="public-main"><div className="public-card"><h1><Bi en="Access not approved." es="Acceso no aprobado."/></h1><p className="public-intro"><Bi en="This account is not an approved owner account." es="Esta cuenta no está aprobada como cuenta del propietario."/></p><form action={signOut}><button className="btn light"><Bi en="Sign out" es="Cerrar sesión"/></button></form></div></main></div>;

  const params = await searchParams;
  const appCursor = decodeCursor(params.apps), leadCursor = decodeCursor(params.leads);
  const invalidCursor = (params.apps && !appCursor) || (params.leads && !leadCursor);
  const pageSize = 25;
  function pageQuery(table, cursor) {
    let query = client.from(table).select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1);
    const filter = beforeFilter(cursor);
    return filter ? query.or(filter) : query;
  }
  const [apps, leads] = await Promise.all([pageQuery('applicants', appCursor), pageQuery('leads', leadCursor)]);
  if (apps.data) apps.data = apps.data.slice(0, pageSize + 1);
  if (leads.data) leads.data = leads.data.slice(0, pageSize + 1);
  const hasMoreApps = (apps.data?.length || 0) > pageSize;
  const hasMoreLeads = (leads.data?.length || 0) > pageSize;
  if (apps.data) apps.data = apps.data.slice(0, pageSize);
  if (leads.data) leads.data = leads.data.slice(0, pageSize);
  function pageLink(kind, cursor) {
    return ownerPageLink(kind, cursor, appCursor ? params.apps : null, leadCursor ? params.leads : null);
  }

  const notifications = apps.data?.length
    ? await client.from('application_notifications').select('applicant_id,status,attempts').in('applicant_id', apps.data.map((a) => a.id))
    : { data: [], error: null };
  const notificationByApplicant = new Map((notifications.data || []).map((n) => [n.applicant_id, n]));
  const referrals = apps.data?.length
    ? await client.from('referral_attributions').select('application_id,employee_id,attributed_at').in('application_id', apps.data.map((a) => a.id))
    : { data: [], error: null };
  const referralByApplicant = new Map((referrals.data || []).map((r) => [r.application_id, r]));
  const onboarding = apps.data?.length
    ? await client.from('employee_onboarding').select('id,applicant_id,started_at').in('applicant_id', apps.data.map((a) => a.id))
    : { data: [], error: null };
  const onboardingByApplicant = new Map((onboarding.data || []).map((o) => [o.applicant_id, o]));
  const tasks = onboarding.data?.length
    ? await client.from('onboarding_tasks').select('onboarding_id,task_code,status').in('onboarding_id', onboarding.data.map((o) => o.id))
    : { data: [], error: null };

  return <div className="public-page"><PublicHeader/><main className="owner-main">
    <div className="owner-heading"><div>
      <div className="mini-label"><Bi en="OWNER WORKSPACE · DEVELOPMENT ACCESS" es="ESPACIO DEL PROPIETARIO · ACCESO DE DESARROLLO"/></div>
      <h1><Bi en="Intake inbox." es="Bandeja de solicitudes."/></h1>
      <p className="public-intro"><Bi en="Applications and quote requests are stored privately. These controls do not send texts." es="Las solicitudes de empleo y presupuestos se guardan de forma privada. Estos controles no envían mensajes de texto."/></p>
    </div><div className="owner-heading-actions"><Link className="btn dark" href="/owner/assistant"><Bi en="Owner assistant" es="Asistente del propietario"/></Link><form action={signOut}><button className="btn light"><Bi en="Sign out" es="Cerrar sesión"/></button></form></div></div>
    <div className="inline-notice"><Bi en="Email-link access is temporary and does not meet the passkey or approved-device requirements for launch." es="El acceso mediante enlace de correo es temporal y no cumple los requisitos de llaves de acceso ni de dispositivos aprobados para el lanzamiento."/></div>
    {params.error && <p className="form-error" role="alert"><Bi en="The update could not be saved. Please try again." es="No se pudo guardar el cambio. Inténtalo de nuevo."/></p>}
    {invalidCursor && <p className="form-error" role="alert"><Bi en="The page link was invalid; showing the latest records for that section." es="El enlace de la página no era válido; se muestran los registros más recientes de esa sección."/></p>}
    {(apps.error || leads.error) ? <div className="inline-notice"><Bi en="The inbox could not be loaded. Check the database setup and try again." es="No se pudo cargar la bandeja. Revisa la configuración de la base de datos e inténtalo de nuevo."/></div> : <>
      <section className="owner-section"><h2><Bi en="Applications" es="Solicitudes de empleo"/> <span>{apps.data.length} <Bi en="shown" es="mostradas"/></span></h2>
        {apps.data.length === 0 ? <p className="muted"><Bi en={appCursor ? 'No applications on this page.' : 'No applications yet.'} es={appCursor ? 'No hay solicitudes en esta página.' : 'Aún no hay solicitudes.'}/></p> : apps.data.map((a) => <article className="owner-record" key={a.id}>
          <div className="record-heading"><div><h3>{a.first_name}</h3><p>{a.area} · <a href={`tel:${a.phone.replace(/[^+\d]/g, '')}`}>{a.phone}</a></p></div><span className="tiny-badge orange">{statusLabel(a.status)}</span></div>
          <div className="record-info">
            <p><strong><Bi en="Owner email:" es="Correo al propietario:"/></strong> {notifications.error ? <Bi en="Delivery status unavailable" es="Estado de entrega no disponible"/> : notificationLabel(notificationByApplicant.get(a.id))}</p>
            <p><strong><Bi en="Availability:" es="Disponibilidad:"/></strong> {a.shifts.map((shift) => shiftLabel(shift)).join(', ')}</p>
            <p><strong><Bi en="Transportation:" es="Transporte:"/></strong> {yesNo(a.transportation)} · <strong><Bi en="Languages:" es="Idiomas:"/></strong> {a.languages.map(languageLabel).join(', ')}</p>
            <p><strong><Bi en="Employee invitation:" es="Invitación de empleado:"/></strong> {referrals.error ? <Bi en="Status unavailable" es="Estado no disponible"/> : referralByApplicant.has(a.id) ? <Bi en={`Attributed to employee ${referralByApplicant.get(a.id).employee_id}`} es={`Atribuida al empleado ${referralByApplicant.get(a.id).employee_id}`}/> : <Bi en="No verified invitation" es="Sin invitación verificada"/>}</p>
            <p><strong><Bi en="Self-reported referral:" es="Referencia declarada:"/></strong> {a.referrer || <Bi en="None provided" es="No proporcionada"/>}</p>
            <p><strong><Bi en="Professional cleaning experience:" es="Experiencia en limpieza profesional:"/></strong> {experienceLabel(a.experience_level)}</p>
            <p><strong><Bi en="Commercial:" es="Comercial:"/></strong> {experienceLabel(a.commercial_experience)} · <strong><Bi en="Residential:" es="Residencial:"/></strong> {experienceLabel(a.residential_experience)} · <strong><Bi en="Professional equipment:" es="Equipo profesional:"/></strong> {experienceLabel(a.equipment_experience)} · <strong><Bi en="Willing to train:" es="Disposición para capacitarse:"/></strong> {experienceLabel(a.training_willingness)}</p>
            <p><strong><Bi en="Text consent:" es="Consentimiento para mensajes de texto:"/></strong> {yesNo(a.sms_consent)} {a.consented_at && <>· {new Date(a.consented_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })} / {new Date(a.consented_at).toLocaleDateString('es-US', { timeZone: 'America/Chicago' })}</>}</p>
          </div>
          <div className="record-actions">
            {!onboarding.error && a.status !== 'passed' && !onboardingByApplicant.has(a.id) && <Action type="application" id={a.id} field="status" value="hired">{a.status === 'hired' ? <Bi en="Start onboarding for previous hire" es="Iniciar incorporación de contratación anterior"/> : <Bi en="Hire & start onboarding" es="Contratar e iniciar incorporación"/>}</Action>}
            {a.status === 'passed' && <Action type="application" id={a.id} field="status" value="new"><Bi en="Reopen application" es="Reabrir solicitud"/></Action>}
            {a.status !== 'hired' && ['passed', 'later', 'screening'].map((value) => <Action key={value} type="application" id={a.id} field="status" value={value}>{statusAction(value)}</Action>)}
          </div>
          {onboarding.error ? <p className="form-error"><Bi en="Onboarding status unavailable. Do not assume an employee record exists." es="El estado de incorporación no está disponible. No supongas que existe un registro de empleado."/></p> : onboardingByApplicant.has(a.id) ? <Onboarding record={onboardingByApplicant.get(a.id)} tasks={tasks.data} error={tasks.error}/> : a.status === 'hired' ? <p className="form-note"><Bi en="Previously marked hired; onboarding has not been started here." es="Marcado como contratado anteriormente; aquí no se ha iniciado la incorporación."/></p> : null}
          <div className="record-clearance"><span><Bi en="Manual clearance:" es="Autorización manual:"/></span>{['school', 'hospital'].map((site) => <Action key={site} type="application" id={a.id} field={`${site}_cleared`} value={String(!a[`${site}_cleared`])}>{<Bi en={site === 'school' ? 'School' : 'Hospital'} es={site === 'school' ? 'Escuela' : 'Hospital'}/>} · {a[`${site}_cleared`] ? <Bi en="Cleared" es="Autorizado"/> : <Bi en="Not cleared" es="No autorizado"/>}</Action>)}</div>
        </article>)}
        <Pagination current={!!appCursor} hasMore={hasMoreApps} next={hasMoreApps ? encodeCursor(apps.data.at(-1)) : null} kind="apps" pageLink={pageLink}/>
      </section>
      <section className="owner-section"><h2><Bi en="Quote requests" es="Solicitudes de presupuesto"/> <span>{leads.data.length} <Bi en="shown" es="mostradas"/></span></h2>
        {leads.data.length === 0 ? <p className="muted"><Bi en={leadCursor ? 'No quote requests on this page.' : 'No quote requests yet.'} es={leadCursor ? 'No hay solicitudes de presupuesto en esta página.' : 'Aún no hay solicitudes de presupuesto.'}/></p> : leads.data.map((lead) => <article className="owner-record" key={lead.id}>
          <div className="record-heading"><div><h3>{lead.contact_name}</h3><p>{buildingLabel(lead.building_type)} · {lead.size} · {frequencyLabel(lead.frequency)}</p></div><span className="tiny-badge orange">{leadStatus(lead.status)}</span></div>
          <div className="record-info"><p><a href={`mailto:${encodeURIComponent(lead.email)}`}>{lead.email}</a> · <a href={`tel:${lead.phone.replace(/[^+\d]/g, '')}`}>{lead.phone}</a></p></div>
          <div className="record-actions">{['contacted', 'closed', 'new'].map((value) => <Action key={value} type="lead" id={lead.id} field="status" value={value}><Bi en={`Mark ${value}`} es={value === 'contacted' ? 'Marcar como contactada' : value === 'closed' ? 'Marcar como cerrada' : 'Marcar como nueva'}/></Action>)}</div>
        </article>)}
        <Pagination current={!!leadCursor} hasMore={hasMoreLeads} next={hasMoreLeads ? encodeCursor(leads.data.at(-1)) : null} kind="leads" pageLink={pageLink}/>
      </section>
    </>}</main></div>;
}

function yesNo(value) { return value ? <Bi en="Yes" es="Sí"/> : <Bi en="No" es="No"/>; }
function statusLabel(value) { return ({ new: <Bi en="New" es="Nueva"/>, hired: <Bi en="Hired" es="Contratada"/>, passed: <Bi en="Passed" es="Descartada"/>, later: <Bi en="Later" es="Más tarde"/>, screening: <Bi en="Screening" es="En revisión"/> })[value] ?? value; }
function statusAction(value) { return ({ passed: <Bi en="Pass" es="Descartar"/>, later: <Bi en="Later" es="Más tarde"/>, screening: <Bi en="Mark screening" es="Marcar en revisión"/> })[value] ?? value; }
function leadStatus(value) { return ({ new: <Bi en="New" es="Nueva"/>, contacted: <Bi en="Contacted" es="Contactada"/>, closed: <Bi en="Closed" es="Cerrada"/> })[value] ?? value; }
function notificationLabel(notification) {
  if (!notification) return <Bi en="No notification recorded" es="No hay notificación registrada"/>;
  if (notification.status === 'sent') return <Bi en="Accepted by email provider" es="Aceptada por el proveedor de correo"/>;
  if (notification.status === 'failed') return <Bi en="Delivery failed — needs attention" es="Falló la entrega — requiere atención"/>;
  if (notification.status === 'processing') return <Bi en="Sending" es="Enviando"/>;
  return notification.attempts ? <Bi en="Waiting to retry" es="Pendiente de reintento"/> : <Bi en="Queued" es="En cola"/>;
}
function experienceLabel(value) {
  return ({ none: <Bi en="None" es="Ninguna"/>, under_one: <Bi en="Less than one year" es="Menos de un año"/>, one_to_three: <Bi en="One to three years" es="De uno a tres años"/>, over_three: <Bi en="More than three years" es="Más de tres años"/>, yes: <Bi en="Yes" es="Sí"/>, no: <Bi en="No" es="No"/>, unsure: <Bi en="Not sure" es="No está seguro"/> })[value] ?? <Bi en="Not provided" es="No proporcionada"/>;
}
function shiftLabel(value) { return ({ days: 'Days / Días', nights: 'Nights / Noches', weekends: 'Weekends / Fines de semana' })[value] ?? value; }
function languageLabel(value) { return ({ English: 'English / Inglés', Spanish: 'Spanish / Español' })[value] ?? value; }
function buildingLabel(value) { return ({ school: <Bi en="School" es="Escuela"/>, clinic: <Bi en="Clinic" es="Clínica"/>, hospital: <Bi en="Hospital" es="Hospital"/>, office: <Bi en="Office" es="Oficina"/>, other: <Bi en="Other" es="Otro"/> })[value] ?? value; }
function frequencyLabel(value) { return ({ daily: <Bi en="Daily" es="Diariamente"/>, weekly: <Bi en="Weekly" es="Semanalmente"/> })[value] ?? value; }

function Pagination({ current, hasMore, next, kind, pageLink }) {
  if (!current && !hasMore) return null;
  const en = kind === 'apps' ? 'applications' : 'quotes';
  const es = kind === 'apps' ? 'solicitudes' : 'presupuestos';
  return <nav className="owner-pagination" aria-label={`${kind === 'apps' ? 'Application' : 'Quote request'} pages / Páginas de ${kind === 'apps' ? 'solicitudes' : 'presupuestos'}`}>
    {current && <Link href={pageLink(kind, null)} className="btn light small"><Bi en={`Latest ${en}`} es={`Más recientes: ${es}`}/></Link>}
    {hasMore && next && <Link href={pageLink(kind, next)} className="btn light small"><Bi en={`Older ${en}`} es={`Más antiguas: ${es}`}/></Link>}
    {hasMore && !next && <p className="form-error"><Bi en="Unable to load the next page. Contact support." es="No se pudo cargar la siguiente página. Contacta al soporte."/></p>}
  </nav>;
}

const onboardingTaskLabels = {
  review_documents: <Bi en="Review required employment documents" es="Revisar los documentos de empleo requeridos"/>,
  plan_training: <Bi en="Plan initial training" es="Planificar la capacitación inicial"/>,
  plan_first_shift: <Bi en="Plan first shift" es="Planificar el primer turno"/>,
};
function Onboarding({ record, tasks, error }) {
  const rows = (tasks || []).filter((task) => task.onboarding_id === record.id);
  return <section className="onboarding-card" aria-label="Onboarding preparation / Preparación de incorporación">
    <h4><Bi en="Onboarding preparation started" es="Se inició la preparación de incorporación"/></h4>
    <p><Bi en="These are owner notes only. No employee account, welcome message, verified documents, actual training assignment or scheduled shift has been created." es="Estas son solo notas del propietario. No se creó una cuenta de empleado, mensaje de bienvenida, documentos verificados, asignación de capacitación ni turno programado."/></p>
    {error || rows.length !== 3 ? <p className="form-error"><Bi en="Onboarding tasks are unavailable. Do not assume they are complete." es="Las tareas de incorporación no están disponibles. No supongas que están completas."/></p> : <ul>{['review_documents', 'plan_training', 'plan_first_shift'].map((code) => {
      const task = rows.find((item) => item.task_code === code);
      return task ? <li key={code}><span>{onboardingTaskLabels[code]} · {task.status === 'recorded' ? <Bi en="Owner noted" es="Anotado por el propietario"/> : <Bi en="Not noted" es="Sin anotar"/>}</span><Action type="onboarding" id={record.id} field={code} value={String(task.status !== 'recorded')}>{task.status === 'recorded' ? <Bi en="Undo note" es="Deshacer nota"/> : <Bi en="Mark noted" es="Marcar como anotado"/>}</Action></li> : <li key={code}><Bi en="Task unavailable" es="Tarea no disponible"/></li>;
    })}</ul>}
  </section>;
}
