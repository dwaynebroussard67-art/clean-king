import PublicHeader from '../public/header';
import IntakeForm from '../public/intake-form';
import { intakeConfig } from '../../lib/server/supabase';
export const dynamic = 'force-dynamic';
export default function Quote(){return <div className="public-page"><PublicHeader/><main className="public-layout"><div className="public-image public-image-quote"><div className="public-image-content"><span>GOOD WORK. EVERY DAY. / BUEN TRABAJO CADA DÍA.</span><strong>A cleaner space starts here. / Un espacio más limpio comienza aquí.</strong><small>Illustrative image, not an actual crew or site / Imagen ilustrativa, no es personal ni un lugar real</small></div></div><div className="public-main"><IntakeForm kind="quote" siteKey={intakeConfig()?.siteKey || null}/></div></main></div>}
