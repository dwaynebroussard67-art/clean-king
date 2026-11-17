import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { processApplicationNotifications } from '../../../../lib/server/application-notifications';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret || ''}`;
  if (!secret || secret.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await processApplicationNotifications(5);
    const status = !result.configured || result.errors ? 503 : 200;
    return NextResponse.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
