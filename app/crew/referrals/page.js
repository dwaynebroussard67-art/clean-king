import Link from 'next/link';
import PublicHeader from '../../public/header';
import { referralsEnabled, sessionClient } from '../../../lib/server/supabase';
import InviteForm from './invite-form';

export const dynamic = 'force-dynamic';

function MessageCard({ title, children }) {
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-main">
        <div className="public-card">
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

export default async function Referrals() {
  if (!referralsEnabled()) {
    return <MessageCard title="Employee referrals / Referencias de empleados">
      <p className="inline-notice">Employee referrals are not available yet. / Las referencias de empleados aún no están disponibles.</p>
    </MessageCard>;
  }

  let client;
  try {
    client = await sessionClient();
  } catch {
    client = null;
  }
  if (!client) {
    return <MessageCard title="Employee referrals / Referencias de empleados">
      <p>Sign in with your employee account to continue. / Inicia sesión con tu cuenta de empleado para continuar.</p>
      <Link href="/owner/login">Sign in / Iniciar sesión</Link>
    </MessageCard>;
  }

  let user;
  try {
    const { data, error } = await client.auth.getUser();
    if (!error) user = data?.user;
  } catch {
    user = null;
  }
  if (!user) {
    return <MessageCard title="Employee referrals / Referencias de empleados">
      <p>Sign in with your employee account to continue. / Inicia sesión con tu cuenta de empleado para continuar.</p>
      <Link href="/owner/login">Sign in / Iniciar sesión</Link>
    </MessageCard>;
  }

  let member;
  try {
    const { data, error } = await client
      .from('employee_memberships')
      .select('active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!error) member = data;
  } catch {
    member = null;
  }
  if (!member?.active) {
    return <MessageCard title="Employee referrals / Referencias de empleados">
      <p>Access is limited to active, approved test employees. / El acceso está limitado a empleados de prueba activos y aprobados.</p>
    </MessageCard>;
  }

  let totals;
  let totalsError = null;
  try {
    const result = await client.rpc('employee_referral_totals');
    totals = result.data;
    totalsError = result.error;
  } catch {
    totalsError = new Error('totals_unavailable');
  }
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-main">
        <div className="public-card">
          <InviteForm created={totals?.[0]?.created ?? 0} submitted={totals?.[0]?.submitted ?? 0} totalsError={!!totalsError} />
        </div>
      </main>
    </div>
  );
}
