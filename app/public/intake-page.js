'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { brand, publicPath } from '../../lib/brand.mjs';
import PublicHeader from './header';
import IntakeForm from './intake-form';
import QuotePlanner from './quote-planner';

export default function IntakePage({ kind, initialLang, siteKey, referralsEnabled = false }) {
  const [lang, setLang] = useState(initialLang);
  const es = lang === 'es';
  const quote = kind === 'quote';
  return <div className="public-page lcj-intake" lang={lang}>
    <PublicHeader current={quote ? 'quote' : 'apply'} lang={lang} onLanguageChange={setLang} />
    <main className="public-layout">
      <div className={`public-image public-image-${quote ? 'quote' : 'apply'}`}>
        <div className="public-image-content"><span>{brand.name}</span>
          <strong>{es ? brand.mottoEs : brand.motto}.</strong>
          <small>{es ? 'Imagen ilustrativa; no representa personal ni instalaciones de clientes.' : 'Illustrative photo, not an actual crew member or client site.'}</small>
        </div>
      </div>
      <div className="public-main">
        <a className="lcj-form-back" href={publicPath('/', lang)}><ArrowLeft size={14} aria-hidden="true" />{es ? 'Volver al inicio' : 'Back to home'}</a>
        <IntakeForm kind={kind} siteKey={siteKey} referralsEnabled={referralsEnabled} lang={lang} />
        {quote && !siteKey && <QuotePlanner lang={lang} key={lang} />}
      </div>
    </main>
  </div>;
}
