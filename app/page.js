import Link from 'next/link';
import { ArrowRight, ArrowUp, ArrowUpRight, Building2, Clock3, ContactRound, Plus, UsersRound } from 'lucide-react';
import { brand, publicPath } from '../lib/brand.mjs';
import PublicHeader from './public/header';
import BrandLockup from './public/brand-lockup';
import FieldHero from './public/field-hero';
import { siteCopy } from './public/site-copy.mjs';

const valueIcons = [UsersRound, ContactRound, Building2];
const images = ['/images/office-space.webp', '/images/floor-care.webp', '/images/glass-care.webp'];

export default async function Home({ searchParams }) {
  const lang = (await searchParams)?.lang === 'es' ? 'es' : 'en';
  const t = siteCopy[lang];
  const quote = publicPath('/quote', lang);
  return <div className="lcj-site" lang={lang} id="top">
    <a className="lcj-skip" href="#main">{t.skip}</a>
    <PublicHeader lang={lang} current="home" />
    <main id="main">
      <FieldHero lang={lang} />
      <div className="lcj-values"><div className="lcj-wrap lcj-values-inner">
        {t.values.map(([label, text], i) => { const Icon = valueIcons[i]; return <div className="lcj-value" key={label}>
          <span className="lcj-value-icon"><Icon size={25} strokeWidth={1.6} aria-hidden="true" /></span>
          <div><strong>{label}</strong><span>{text}</span></div>
        </div>; })}
      </div></div>
      <section className="lcj-wrap lcj-guide lcj-section" id="services" aria-labelledby="guide-title">
        <div className="lcj-kicker"><span />{t.serviceLabel}</div>
        <div className="lcj-section-heading"><h2 id="guide-title">{t.serviceTitle}<em>.</em></h2><p>{t.serviceIntro}</p></div>
        <div className="lcj-service-grid">
          {t.serviceItems.map((item, i) => <article key={item.title} className="lcj-service-card">
            <div className="lcj-service-photo"><img src={images[i]} loading="lazy" width="600" height="400" alt="" />
              <span className="lcj-index">S <i>/</i> 0{i + 1}</span>
            </div>
            <div className="lcj-service-body"><div className="lcj-caption-label">{item.label}</div>
              <h3>{item.title}</h3><p>{item.description}</p>
              <details className="lcj-planning"><summary>{t.guideLabel}<Plus size={16} aria-hidden="true" /></summary>
                <p>{item.detail}</p><Link href={quote}>{t.detailLink}<ArrowUpRight size={15} aria-hidden="true" /></Link>
              </details>
            </div>
          </article>)}
        </div>
      </section>
      <section className="lcj-people lcj-section" id="people" aria-labelledby="people-title">
        <div className="lcj-wrap lcj-people-inner">
          <div className="lcj-seal-panel"><div className="lcj-seal-field"><img src={brand.seal} width="260" height="260" loading="lazy" alt={`${brand.name} — ${brand.motto}`} /></div>
            <div className="lcj-seal-caption"><span>LCJ <i>/</i> LA</span><span>{t.category}</span></div>
          </div>
          <div className="lcj-people-copy"><div className="lcj-kicker"><span />{t.peopleLabel}</div>
            <h2 id="people-title">{t.peopleTitle}<em>.</em></h2>
            <div className="lcj-byline"><span aria-hidden="true">AM</span><div><strong>{brand.owner}</strong><small>{t.ownerRole}</small></div></div>
            <p>{t.ownerCopy}</p>
            <details className="lcj-page-note"><summary><Clock3 size={16} aria-hidden="true" />{t.pageListing}<Plus size={15} aria-hidden="true" /></summary><p>{t.listingNote}</p></details>
          </div>
        </div>
      </section>
      <section className="lcj-wrap lcj-careers" aria-labelledby="careers-title">
        <div><div className="lcj-kicker"><span />{t.careersLabel}</div><h2 id="careers-title">{t.careersTitle}</h2><p>{t.careersCopy}</p></div>
        <Link className="lcj-button lcj-button-navy" href={publicPath('/apply', lang)}>{t.apply}<ArrowRight size={17} aria-hidden="true" /></Link>
      </section>
    </main>
    <footer className="lcj-footer"><div className="lcj-wrap">
      <div className="lcj-footer-top"><Link href={publicPath('/', lang)} aria-label={brand.name}><BrandLockup /></Link>
        <nav aria-label={lang === 'es' ? 'Enlaces del pie de página' : 'Footer links'}>
          <Link href={quote}>{t.quote}</Link><Link href="/workspace">{t.workspace}</Link><Link href="/owner" prefetch={false}>{t.signIn}</Link>
        </nav>
      </div>
      <div className="lcj-footer-base"><span>{t.footerNote}</span><a href="#top">{t.top}<ArrowUp size={13} aria-hidden="true" /></a></div>
    </div></footer>
  </div>;
}
