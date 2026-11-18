'use server';
import { randomBytes, createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { referralsEnabled, sessionClient, adminClient } from '../../../lib/server/supabase';

export async function createInvitation() {
  if (!referralsEnabled()) return { error: 'Invitations are unavailable.' };
  const client = await sessionClient();
  if (!client) return { error: 'Sign-in is required.' };
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: 'Sign-in is required.' };
  const code = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(code).digest('hex');
  const admin = adminClient();
  if (!admin) return { error: 'Invitations are unavailable.' };
  // Only the verified session user is passed to this service-only function.
  const { data: expires, error } = await admin.rpc('create_employee_invitation', { p_employee_id: user.id, p_hash: hash });
  if (error || !expires) return { error: 'Could not create an invitation. Check your account or try again later.' };
  // The raw code is displayed only once and is not stored in our database.
  const link = new URL('/apply', process.env.APP_ORIGIN);
  link.hash = `ref=${code}`;
  revalidatePath('/crew/referrals');
  return { link: link.toString(), code, expires };
}
