import { NextResponse } from 'next/server';
import { sessionClient, ownerLoginEnabled } from '../../../../lib/server/supabase';
export const dynamic = 'force-dynamic';
export async function GET(request){
  const url=new URL(request.url), code=url.searchParams.get('code');
  if(ownerLoginEnabled() && code){
    const client=await sessionClient();
    const {error}=await client.auth.exchangeCodeForSession(code);
    if(!error) return NextResponse.redirect(new URL('/owner', request.url));
  }
  return NextResponse.redirect(new URL('/owner/login?state=invalid',request.url));
}
