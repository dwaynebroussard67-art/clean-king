import PublicHeader from '../public/header';
import IntakeForm from '../public/intake-form';
import { intakeConfig, referralsEnabled } from '../../lib/server/supabase';
export const dynamic = 'force-dynamic';
export default function Apply(){return <div className="public-page"><PublicHeader/><main className="public-layout"><div className="public-image public-image-apply"><div className="public-image-content"><span>GOOD WORK. EVERY DAY. / BUEN TRABAJO CADA DÍA.</span><strong>People make the difference. / Las personas hacen la diferencia.</strong><small>Illustrative image, not an actual crew or site / Imagen ilustrativa, no es personal ni un lugar real</small></div></div><div className="public-main"><IntakeForm kind="application" referralsEnabled={referralsEnabled()} siteKey={intakeConfig()?.siteKey || null}/></div></main></div>}
