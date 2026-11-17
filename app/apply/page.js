import PublicHeader from '../public/header';
import IntakeForm from '../public/intake-form';
import { intakeConfig } from '../../lib/server/supabase';
export const dynamic = 'force-dynamic';
export default function Apply(){return <div className="public-page"><PublicHeader/><main className="public-main"><IntakeForm kind="application" siteKey={intakeConfig()?.siteKey || null}/></main></div>}
