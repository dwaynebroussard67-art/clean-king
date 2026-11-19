import Link from 'next/link';
import PublicHeader from '../../public/header';
import { referralsEnabled, sessionClient } from '../../../lib/server/supabase';
import InviteForm from './invite-form';
export const dynamic = 'force-dynamic';
export default async function Referrals() {
  if (!referralsEnabled()) return <div className="public-page"><PublicHeader/><main className="public-main"><div className="public-card"><h1>Employee referrals</h1><p className="inline-notice">Employee referrals are not available yet.</p></div></main></div>;
  const client = await sessionClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return <div className="public-page"><PublicHeader/><main className="public-main"><div className="public-card"><h1>Employee referrals / Referencias de empleados</h1><p>Sign in with your employee account to continue. / Inicia sesión con tu cuenta de empleado para continuar.</p><Link href="/owner/login">Sign in / Iniciar sesión</Link></div></main></div>;
  const { data: member } = await client.from('employee_memberships').select('active').eq('user_id', user.id).maybeSingle();
  if (!member?.active) return <div className="public-page"><PublicHeader/><main className="public-main"><div className="public-card"><h1>Employee referrals</h1><p>Access is limited to active, approved test employees.</p></div></main></div>;
  const { data: totals, error: totalsError } = await client.rpc('employee_referral_totals');
  return <div className="public-page"><PublicHeader/><main className="public-main"><div className="public-card"><InviteForm created={totals?.[0]?.created ?? 0} submitted={totals?.[0]?.submitted ?? 0} totalsError={!!totalsError}/></div></main></div>;
}
