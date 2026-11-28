import IntakePage from '../public/intake-page';
import { intakeConfig, referralsEnabled } from '../../lib/server/supabase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Crew application' };

export default async function Apply({ searchParams }) {
  const lang = (await searchParams)?.lang === 'es' ? 'es' : 'en';
  return <IntakePage key={lang} kind="application" initialLang={lang} referralsEnabled={referralsEnabled()} siteKey={intakeConfig()?.siteKey || null} />;
}
