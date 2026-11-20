'use client';

import { useId, useRef, useState } from 'react';
import { answer } from '../../lib/public-assistant/engine.mjs';
import { MAX_INPUT } from '../../lib/public-assistant/format.mjs';
import { copy } from '../../lib/public-assistant/i18n.mjs';
import './public-assistant.css';

const faqPaths = { 'faq.apply': '/apply', 'faq.quote': '/quote', 'faq.confirm': '/quote' };

function Reply({ result }) {
  const path = faqPaths[result.intent];
  if (!path || !result.text.endsWith(path)) return result.text;
  return <>{result.text.slice(0, -path.length)}<a href={path}>{path}</a></>;
}

export default function PublicAssistant({ lang }) {
  const language = lang === 'es' ? 'es' : 'en';
  const ui = copy[language];
  const inputId = useId();
  const input = useRef(null);
  const nextId = useRef(0);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState([]);

  function send(raw) {
    const question = raw.trim();
    if (!question || raw.length > MAX_INPUT) return;
    const turn = { id: nextId.current++, lang: language, question, result: answer(question, { lang: language }) };
    setTurns(previous => [turn, ...previous.slice(0, 11)]);
    setDraft('');
    input.current?.focus();
  }

  return (
    <details className="pa-card" lang={language}>
      <summary className="pa-title"><h2>{ui.title}</h2></summary>
      <div className="pa-body">
        <p className="pa-note">{ui.privacy}</p>
        <fieldset className="pa-examples">
          <legend>{ui.tryOne}</legend>
          <div className="pa-chips">
            {ui.examples.map(example => (
              <button className="pa-chip" key={example} type="button" onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="pa-label" htmlFor={inputId}>{ui.question}</label>
        <div className="pa-entry">
          <input id={inputId} ref={input} type="text" value={draft} maxLength={MAX_INPUT}
            placeholder={ui.placeholder} autoComplete="off" spellCheck={false} enterKeyHint="send"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(draft);
              }
            }} />
          <button type="button" className="pa-send" disabled={!draft.trim()} onClick={() => send(draft)}>
            {ui.send}
          </button>
        </div>
        <ol className="pa-log" aria-label={ui.recent} aria-live="polite" aria-relevant="additions">
          {turns.map(({ id, question, result, lang: turnLang }) => (
            <li key={id} className="pa-turn" lang={turnLang}>
              <p><strong>{copy[turnLang].you}: </strong>{question}</p>
              <p className="pa-answer"><strong>{copy[turnLang].helper}: </strong><Reply result={result} /></p>
              {result.steps?.length > 0 && (
                <details className="pa-work">
                  <summary>{copy[turnLang].steps}</summary>
                  <ul>{result.steps.map((step, index) => <li key={index}>{step}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
