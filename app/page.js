import Link from 'next/link';
import PublicHeader from './public/header';
import PublicAssistant from './public/public-assistant';
import { defaultBrand } from '../lib/brand.mjs';

const copy = {
  en: {
    preview: 'SITE PREVIEW · Business details and services are awaiting owner approval. Forms are not accepting submissions.',
    eyebrow: 'A PEOPLE-FIRST APPROACH', hero1: 'A cleaner space.', hero2: 'A stronger team.',
    intro: 'It starts with people. Discover a people-first approach to commercial cleaning.', quote: 'Request a quote', join: 'Join our team', photo: 'ILLUSTRATIVE PHOTO · NOT ACTUAL CREW', sitePhoto: 'ILLUSTRATIVE PHOTO · NOT AN ACTUAL SITE',
    values: 'THE HEART OF OUR WORK', valuesTitle: 'People make the difference.', valuesText: 'Thoughtful work starts with a team that matters.',
    services: '01 / WHAT WE DO', servicesTitle: 'A better environment', servicesEnd: 'starts here.', servicesText: 'Every workplace is different. Tell us about your space and the cleaning you’re looking for.', servicesPending: 'Specific services and areas served are awaiting owner approval.', discuss: 'Discuss your needs',
    about: '02 / OUR APPROACH', aboutTitle: 'Our people', aboutEnd: 'are our assets.', aboutText: 'Good work begins with people. That belief is at the heart of', aboutPending: 'Andy’s story will be added when he approves it.',
    contact: '03 / LET’S CONNECT', contactTitle: 'Let’s talk about', contactEnd: 'your space.', contactText: 'Have a question or want to discuss your cleaning needs? Start with a quote request when intake is available.', contactPending: 'Contact information and hours are awaiting owner approval.',
    help: 'Have a question?', servicesNav: 'Services', aboutNav: 'About', owner: 'Owner access', footer: 'Preview only · No real submissions',
  },
  es: {
    preview: 'VISTA PREVIA · Los servicios y datos del negocio esperan aprobación. Los formularios no reciben solicitudes.',
    eyebrow: 'UN ENFOQUE CENTRADO EN LAS PERSONAS', hero1: 'Un espacio más limpio.', hero2: 'Un equipo más fuerte.',
    intro: 'Todo comienza con las personas. Descubre un enfoque de limpieza comercial centrado en ellas.', quote: 'Solicitar cotización', join: 'Únete al equipo', photo: 'FOTO ILUSTRATIVA · NO ES PERSONAL REAL', sitePhoto: 'FOTO ILUSTRATIVA · NO ES UN LUGAR REAL',
    values: 'EL CORAZÓN DE NUESTRO TRABAJO', valuesTitle: 'Las personas marcan la diferencia.', valuesText: 'Un trabajo cuidadoso comienza con un equipo que importa.',
    services: '01 / QUÉ HACEMOS', servicesTitle: 'Un mejor ambiente', servicesEnd: 'comienza aquí.', servicesText: 'Cada lugar de trabajo es diferente. Cuéntanos sobre tu espacio y la limpieza que necesitas.', servicesPending: 'Los servicios específicos y las áreas atendidas esperan la aprobación del propietario.', discuss: 'Cuéntanos lo que necesitas',
    about: '02 / NUESTRO ENFOQUE', aboutTitle: 'Nuestra gente', aboutEnd: 'es nuestro mayor valor.', aboutText: 'El buen trabajo comienza con las personas. Esa convicción está en el corazón de', aboutPending: 'La historia de Andy se añadirá cuando él la apruebe.',
    contact: '03 / HABLEMOS', contactTitle: 'Hablemos de', contactEnd: 'tu espacio.', contactText: '¿Tienes preguntas o quieres hablar de tus necesidades de limpieza? Solicita una cotización cuando el formulario esté disponible.', contactPending: 'La información de contacto y el horario esperan la aprobación del propietario.',
    help: '¿Tienes preguntas?', servicesNav: 'Servicios', aboutNav: 'Nosotros', owner: 'Acceso del propietario', footer: 'Solo vista previa · No enviar datos reales',
  },
};

export default async function Page({ searchParams }) {
  const params = await searchParams;
  const lang = params?.lang === 'es' ? 'es' : 'en';
  const t = copy[lang];
  const suffix = lang === 'es' ? '?lang=es' : '';
  return <div className="lcj-site" lang={lang}>
    <div className="lcj-preview">{t.preview}</div>
    <PublicHeader lang={lang} />
    <main>
      <section className="lcj-hero"><div className="lcj-hero-inner">
        <div className="lcj-eyebrow"><span /> {t.eyebrow}</div><h1>{t.hero1}<br/><em>{t.hero2}</em></h1>
        <p>{defaultBrand.name}: {t.intro}</p>
        <div className="lcj-actions"><Link className="lcj-button primary" href={`/quote${suffix}`}>{t.quote} <span>↗</span></Link><Link className="lcj-button secondary" href={`/apply${suffix}`}>{t.join} <span>→</span></Link></div>
        <div className="lcj-hero-note"><span className="lcj-note-line" /> {defaultBrand.tagline}</div>
      </div><div className="lcj-photo"><span>{t.photo}</span></div></section>
      <section className="lcj-values" aria-label={t.aboutNav}><p>{t.values}</p><strong>{t.valuesTitle}</strong><span>{t.valuesText}</span></section>
      <section className="lcj-section lcj-services" id="services"><div><div className="lcj-kicker">{t.services}</div><h2>{t.servicesTitle}<br/><em>{t.servicesEnd}</em></h2></div><div className="lcj-section-copy"><p>{t.servicesText}</p><p className="lcj-pending">{t.servicesPending}</p><Link className="lcj-text-link" href={`/quote${suffix}`}>{t.discuss} <span>↗</span></Link></div></section>
      <section className="lcj-about" id="about"><div className="lcj-about-image"><span>{t.sitePhoto}</span></div><div className="lcj-about-copy"><div className="lcj-kicker">{t.about}</div><h2>{t.aboutTitle}<br/><em>{t.aboutEnd}</em></h2><p>{t.aboutText} {defaultBrand.name}.</p><p className="lcj-pending">{t.aboutPending}</p><Link className="lcj-text-link" href={`/apply${suffix}`}>{t.join} <span>↗</span></Link></div></section>
      <section className="lcj-contact" id="contact"><div><div className="lcj-kicker">{t.contact}</div><h2>{t.contactTitle}<br/><em>{t.contactEnd}</em></h2><p>{t.contactText}</p><p className="lcj-pending">{t.contactPending}</p></div><Link className="lcj-button light" href={`/quote${suffix}`}>{t.quote} <span>↗</span></Link></section>
      <section className="lcj-help" aria-label={t.help}><PublicAssistant lang={lang} /></section>
    </main>
    <footer className="lcj-footer"><div><strong>{defaultBrand.name}</strong><p>{defaultBrand.tagline}</p></div><div className="lcj-footer-links"><Link href={`${suffix || '/'}#services`}>{t.servicesNav}</Link><Link href={`${suffix || '/'}#about`}>{t.aboutNav}</Link><Link href={`/apply${suffix}`}>{t.join}</Link><Link href={`/quote${suffix}`}>{t.quote}</Link><Link href="/owner">{t.owner}</Link></div><small>{t.footer}</small></footer>
  </div>;
}
