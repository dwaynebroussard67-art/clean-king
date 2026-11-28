import IntakePage from '../public/intake-page';
import { intakeConfig } from '../../lib/server/supabase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request a quote' };

export default async function Quote({ searchParams }) {
  const lang = (await searchParams)?.lang === 'es' ? 'es' : 'en';
  return <IntakePage key={lang} kind="quote" initialLang={lang} siteKey={intakeConfig()?.siteKey || null} />;
}
