'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ownerLoginEnabled,sessionClient } from '../../../lib/server/supabase';
import { parseAssistantSettings } from '../../../lib/assistant-settings.mjs';
export async function saveAssistantSettings(form){
 if(!ownerLoginEnabled())redirect('/owner/login');
 const parsed=parseAssistantSettings(form);if(!parsed)redirect('/owner/assistant?settings=invalid');
 const client=await sessionClient();if(!client)redirect('/owner/login');
 const {data:{user},error}=await client.auth.getUser();if(error||!user)redirect('/owner/login');
 const {data:member,error:memberError}=await client.from('owner_memberships').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError||!member)redirect('/owner');
 const {data,error:saveError}=await client.rpc('update_assistant_settings',parsed);
 if(saveError||data!==true)redirect('/owner/assistant?settings=error');
 revalidatePath('/owner/assistant');redirect('/owner/assistant?settings=saved');
}
