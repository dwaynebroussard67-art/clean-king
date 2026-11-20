import Link from 'next/link';
import { redirect } from 'next/navigation';
import PublicHeader from '../../public/header';
import { assistantConfig } from '../../../lib/assistant.mjs';
import { ownerLoginEnabled, sessionClient } from '../../../lib/server/supabase';
import { saveAssistantSettings } from './actions';
import OwnerChat from './owner-chat';
import ConnectionTest from './connection-check';
export const dynamic='force-dynamic';
export default async function AssistantPage({searchParams}){
 if(!ownerLoginEnabled())redirect('/owner/login');
 const client=await sessionClient();
 const {data:{user},error}=await client.auth.getUser();if(error||!user)redirect('/owner/login');
 const {data:member,error:memberError}=await client.from('owner_memberships').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError||!member)redirect('/owner');
 const {data:settings,error:settingsError}=await client.from('assistant_settings').select('owner_name,provider,persona,include_counts,per_minute,per_month').maybeSingle();
 const params=await searchParams,enabled=!!settings&&!settingsError&&!!assistantConfig(process.env,settings.provider);
 return <div className="public-page"><PublicHeader/><main className="owner-main assistant-owner"><Link className="back-link" href="/owner">← Owner inbox / Bandeja del dueño</Link><div className="mini-label">OWNER ASSISTANT · DEVELOPMENT ACCESS</div><h1>A little help, right when you need it.</h1><p className="public-intro">Owner-only, read-only assistant. Never use real sensitive information in this test environment.</p>
 {settingsError||!settings?<p className="form-error" role="alert">Assistant settings are unavailable. Apply the matching migration in an approved test project.</p>:<>
 <details className="assistant-settings"><summary>Assistant settings</summary><p>Provider keys, model and allowed host are configured on the server—not in this page. No automatic fallback. The question is sent to the selected provider; counts are sent only if enabled. No hiring, messaging or scheduling tools exist.</p>
 {params.settings==='saved'&&<p className="intake-success" role="status">Settings saved.</p>}{['invalid','error'].includes(params.settings)&&<p className="form-error" role="alert">Settings could not be saved. Check the fields and try again.</p>}
 <form className="assistant-settings-form" action={saveAssistantSettings}>
 <label>Owner display name<input name="owner_name" required maxLength={40} defaultValue={settings.owner_name}/></label>
 <label>Provider<select name="provider" defaultValue={settings.provider}><option value="anthropic">Anthropic</option><option value="open">OpenAI-compatible slot</option></select></label>
 <label>Text tone<select name="persona" defaultValue={settings.persona}><option value="enthusiastic">Enthusiastic and helpful</option><option value="calm">Calm and concise</option></select></label>
 <label>Requests per minute (1–3)<input type="number" name="per_minute" min="1" max="3" required defaultValue={settings.per_minute}/></label>
 <label>Requests per month (1–100)<input type="number" name="per_month" min="1" max="100" required defaultValue={settings.per_month}/></label>
 <label className="settings-checkbox"><input type="checkbox" name="include_counts" defaultChecked={settings.include_counts}/>Send aggregate application, quote and email queue counts to the selected provider</label>
 <button className="btn dark" type="submit">Save settings</button></form>
 <p className="form-note">A request limit is not a dollar cap. Configure provider-side spending limits separately. Changes cannot recall requests already in progress. Audio voice is not implemented.</p><ConnectionTest/>
 </details><OwnerChat enabled={enabled} ownerName={settings.owner_name} includeCounts={settings.include_counts} provider={settings.provider}/></>}
 </main></div>;
}
