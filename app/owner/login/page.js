import { redirect } from 'next/navigation';
import PublicHeader from '../../public/header';
import { requestLink } from '../actions';
import { ownerLoginEnabled, sessionClient } from '../../../lib/server/supabase';
export const dynamic='force-dynamic';
export default async function Login({searchParams}){
 const {state}=await searchParams; const enabled=ownerLoginEnabled();
 if(enabled){const client=await sessionClient(); const {data:{user}}=await client.auth.getUser(); if(user) redirect('/owner');}
 return <div className="public-page"><PublicHeader/><main className="public-main"><div className="public-card"><div className="mini-label">OWNER ACCESS</div><h1>Welcome back.</h1><p className="public-intro">Owner access is restricted to explicitly approved accounts.</p>{!enabled?<div className="inline-notice">Owner sign-in is not configured. Passkeys and approved-device controls are required before launch.</div>:<><div className="inline-notice">Development access only: email links do not yet provide passkey or approved-device protection.</div>{state==='sent'?<p className="intake-success" role="status">If the account is eligible, a sign-in link has been sent. Open it on this device.</p>:<form className="public-form" action={requestLink}><label>Email address<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>{state==='invalid'&&<p className="form-error">Could not sign in. Please try again.</p>}<button className="btn dark public-submit">Send sign-in link</button></form>}</>}</div></main></div>
}
