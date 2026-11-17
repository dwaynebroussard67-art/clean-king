import Link from 'next/link';
import { redirect } from 'next/navigation';
import PublicHeader from '../../public/header';
import { assistantConfig } from '../../../lib/assistant.mjs';
import { ownerLoginEnabled, sessionClient } from '../../../lib/server/supabase';
import OwnerChat from './owner-chat';
export const dynamic='force-dynamic';
export default async function AssistantPage(){
 if(!ownerLoginEnabled())redirect('/owner/login');
 const client=await sessionClient();
 const {data:{user},error}=await client.auth.getUser();if(error||!user)redirect('/owner/login');
 const {data:member,error:memberError}=await client.from('owner_memberships').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError||!member)redirect('/owner');
 const enabled=!!assistantConfig(process.env);
 return <div className="public-page"><PublicHeader/><main className="owner-main assistant-owner"><Link className="back-link" href="/owner">← Owner inbox / Bandeja del dueño</Link><div className="mini-label">OWNER ASSISTANT · DEVELOPMENT PREVIEW</div><h1>A little help, right when you need it.</h1><p className="public-intro">A first step toward an assistant that keeps your day moving.</p><OwnerChat enabled={enabled}/></main></div>;
}
