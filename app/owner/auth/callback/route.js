import { NextResponse } from 'next/server';
import { signedInDestination } from '../../../../lib/server/auth-destination.js';
import { sessionClient, ownerLoginEnabled } from '../../../../lib/server/supabase.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const code = new URL(request.url).searchParams.get('code');
  if (ownerLoginEnabled() && code) {
    const client = await sessionClient();
    if (client) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        const { data, error: userError } = await client.auth.getUser();
        const destination = userError || !data?.user?.id
          ? '/not-approved'
          : await signedInDestination(client, data.user.id);
        return NextResponse.redirect(new URL(destination, request.url));
      }
    }
  }
  return NextResponse.redirect(new URL('/owner/login?state=invalid', request.url));
}
