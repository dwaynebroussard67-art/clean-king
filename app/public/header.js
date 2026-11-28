import Link from 'next/link';
import { defaultBrand } from '../../lib/brand.mjs';

export default function PublicHeader({ lang = 'en' }) {
  const es = lang === 'es';
  const home = es ? '/?lang=es' : '/';
  const suffix = es ? '?lang=es' : '';
  return <header className="lcj-header">
    <Link className="lcj-brand" href={home} aria-label={`${defaultBrand.name} ${es ? 'inicio' : 'home'}`}>
      <span className="lcj-brand-name">{defaultBrand.name}</span><span className="lcj-brand-tagline">{defaultBrand.tagline}</span>
    </Link>
    <nav className="lcj-nav" aria-label={es ? 'Navegación principal' : 'Main navigation'}>
      <Link href={`${home}#services`}>{es ? 'Servicios' : 'Services'}</Link><Link href={`${home}#about`}>{es ? 'Nosotros' : 'About'}</Link>
      <Link href={`${home}#contact`}>{es ? 'Contacto' : 'Contact'}</Link><Link href={`/apply${suffix}`}>{es ? 'Únete al equipo' : 'Join the team'}</Link>
      <Link className="lcj-nav-cta" href={`/quote${suffix}`}>{es ? 'Solicitar cotización' : 'Request a quote'} <span aria-hidden="true">↗</span></Link>
      <Link href={es ? '/' : '/?lang=es'} hrefLang={es ? 'en' : 'es'}>{es ? 'English' : 'Español'}</Link>
    </nav>
  </header>;
}
