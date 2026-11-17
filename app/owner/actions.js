'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sessionClient, ownerLoginEnabled } from '../../lib/server/supabase';

export async function requestLink(form) {
  if (!ownerLoginEnabled()) redirect('/owner/login?state=disabled');
  const email = String(form.get('email') || '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect('/owner/login?state=invalid');
  const client = await sessionClient();
  try { await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: new URL('/owner/auth/callback', process.env.APP_ORIGIN).toString() } }); } catch { /* Do not disclose account existence or provider errors. */ }
  redirect('/owner/login?state=sent');
}
export async function signOut() {
  const client = await sessionClient();
  if (client) await client.auth.signOut();
  redirect('/owner/login');
}
async function authorizedClient(){
  if(!ownerLoginEnabled()) return null;
  const client=await sessionClient(); if(!client)return null;
  const {data:{user},error}=await client.auth.getUser(); if(error||!user)return null;
  const {data:membership}=await client.from('owner_memberships').select('user_id').eq('user_id',user.id).maybeSingle();
  return membership ? client : null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function updateIntake(form){
  const client=await authorizedClient(); if(!client) redirect('/owner/login');
  const type=String(form.get('type')), id=String(form.get('id')), field=String(form.get('field')), value=String(form.get('value'));
  if(!uuid.test(id)) return;
  let table, update;
  if(type==='application' && field==='status' && ['new','later','screening','hired','passed'].includes(value)){table='applicants';update={status:value}}
  else if(type==='application' && ['school_cleared','hospital_cleared'].includes(field) && ['true','false'].includes(value)){table='applicants';update={[field]:value==='true'}}
  else if(type==='lead' && field==='status' && ['new','contacted','closed'].includes(value)){table='leads';update={status:value}}
  else return;
  const {error}=await client.from(table).update(update).eq('id',id);
  if(error) redirect('/owner?error=update');
  revalidatePath('/owner');
}
