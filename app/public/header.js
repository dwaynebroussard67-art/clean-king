'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Globe2, LockKeyhole, MapPin, Menu, X } from 'lucide-react';
import { brand, publicPath } from '../../lib/brand.mjs';
import BrandLockup from './brand-lockup';
import { siteCopy } from './site-copy.mjs';

export default function PublicHeader({ lang = 'en', current, onLanguageChange }) {
  const t = siteCopy[lang];
  const home = publicPath('/', lang);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef(null);
  const header = useRef(null);
  useEffect(() => {
    if (!expanded) return;
    const key = e => { if (e.key === 'Escape') { setExpanded(false); trigger.current?.focus(); } };
    const outside = e => { if (!header.current?.contains(e.target)) setExpanded(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [expanded]);
  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = 'en'; };
  }, [lang]);
  const nextLang = lang === 'en' ? 'es' : 'en';
  const switchLabel = lang === 'en' ? 'Español' : 'English';
  const links = [
    ['home', t.home, home], ['services', t.services, `${home}#services`],
    ['people', t.people, `${home}#people`], ['apply', t.careers, publicPath('/apply', lang)],
  ];
  return <header className="lcj-header" ref={header}>
    <div className="lcj-utility"><div className="lcj-wrap lcj-utility-inner">
      <span className="lcj-location"><MapPin size={13} aria-hidden="true" />{t.location}<i aria-hidden="true" /><span>{t.category}</span></span>
      <div className="lcj-utility-links">
        {(current === 'home' || onLanguageChange) && (onLanguageChange
          ? <button type="button" onClick={() => onLanguageChange(nextLang)} lang={nextLang}><Globe2 size={13} aria-hidden="true" />{switchLabel}</button>
          : <Link href={publicPath('/', nextLang)} lang={nextLang}><Globe2 size={13} aria-hidden="true" />{switchLabel}</Link>)}
        <Link href="/owner" prefetch={false}><LockKeyhole size={12} aria-hidden="true" />{t.signIn}</Link>
      </div>
    </div></div>
    <div className="lcj-wrap lcj-masthead">
      <Link className="lcj-brand-link" href={home} aria-label={`${brand.name} — ${t.home}`}><BrandLockup /></Link>
      <div className="lcj-nav-side">
        <button className="lcj-menu-toggle" ref={trigger} type="button" aria-label={expanded ? t.close : t.open}
          aria-expanded={expanded} aria-controls="lcj-nav" onClick={() => setExpanded(v => !v)}>
          {expanded ? <X size={23} aria-hidden="true" /> : <Menu size={23} aria-hidden="true" />}
        </button>
        <nav id="lcj-nav" className="lcj-nav" data-expanded={expanded} aria-label={t.nav}>
          {links.map(([id, label, href]) => <Link key={id} href={href} aria-current={current === id ? 'page' : undefined}
            onClick={() => setExpanded(false)}>{label}</Link>)}
        </nav>
        <Link className="lcj-button lcj-button-navy lcj-header-quote" href={publicPath('/quote', lang)}>{t.quote}<ArrowUpRight size={17} aria-hidden="true" /></Link>
      </div>
    </div>
  </header>;
}
