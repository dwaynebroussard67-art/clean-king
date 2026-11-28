'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, ScanLine } from 'lucide-react';
import { siteCopy } from './site-copy.mjs';

const photos = ['/images/glass-care.webp', '/images/floor-care.webp', '/images/office-space.webp'];

export default function FieldHero({ lang }) {
  const [slide, setSlide] = useState(0);
  const t = siteCopy[lang];
  function advance(n) { setSlide(i => (i + n + photos.length) % photos.length); }
  return <section className="lcj-hero" aria-labelledby="lcj-hero-title">
    <div className="lcj-hero-photo">
      <img src={photos[slide]} alt={t.slides[slide][1]} width="1264" height="848" fetchPriority="high" />
    </div>
    <div className="lcj-hero-panel" aria-hidden="true" />
    <div className="lcj-wrap lcj-hero-inner">
      <div className="lcj-hero-copy">
        <div className="lcj-kicker lcj-hero-kicker"><span />{t.heroLabel}</div>
        <h1 id="lcj-hero-title">{t.firstLine} <em>{t.secondLine}.</em></h1>
        <p>{t.intro}</p>
        <div className="lcj-hero-actions">
          <a href="#services" className="lcj-button lcj-button-sky">{t.explore}<ArrowRight size={17} aria-hidden="true" /></a>
          <a href="#people" className="lcj-hero-link">{t.meet}<ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
      </div>
    </div>
    <div className="lcj-field-caption">
      <div className="lcj-caption-copy" aria-live="polite" aria-atomic="true">
        <small><ScanLine size={13} aria-hidden="true" />{t.field} <span>/</span> 0{slide + 1}</small>
        <strong>{t.slides[slide][0]}</strong>
      </div>
      <div className="lcj-photo-controls">
        <button type="button" aria-label={t.previous} onClick={() => advance(-1)}><ChevronLeft size={17} /></button>
        <button type="button" aria-label={t.next} onClick={() => advance(1)}><ChevronRight size={17} /></button>
      </div>
    </div>
  </section>;
}
