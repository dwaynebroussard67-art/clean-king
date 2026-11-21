'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Volume2, X } from 'lucide-react';
import './settings.css';

const copy = {
  en: {
    title: 'Your assistant', switch: 'Español', log: 'Conversation', question: 'Your question',
    notice: 'Read only. Your question, excerpts of up to six recent messages and enabled counts may be shared with the selected provider. Do not enter names, contact details, credentials or other sensitive information.',
    context: 'Enter to send. Shift + Enter for a new line. Reload to clear this conversation.',
    intro: (name, owner) => `Hello ${owner}. I’m ${name}. Ask me about the enabled business counts.`,
    suggestion: 'What needs attention?', placeholder: 'How many new quote requests are there?',
    send: 'Send question', waiting: 'Waiting for a reply…', you: 'You', mute: 'Mute replies', stop: 'Stop speaking',
    settings: 'Open settings', login: 'Sign in', custom: 'Custom', by: 'Answered by',
    errors: {
      not_configured: 'The assistant is unavailable in this environment.',
      sign_in: 'Your session ended. Sign in to continue.',
      not_authorized: 'This account does not have owner access.',
      rate_limited: 'The workspace reached its minute or monthly limit. Try again later.',
      disabled: 'The assistant is off. Both the server gate and the saved switch must be enabled.',
      provider_not_set: 'Check the saved provider, key and model.',
      provider_failed: 'The assistant could not complete the request. Try again later.',
      too_large: 'This request is too long. Try a shorter question.',
      invalid: 'Check your question and try again.',
      rejected: 'The request was rejected. Reopen the workspace at its approved address.',
    },
  },
  es: {
    title: 'Tu asistente', switch: 'English', log: 'Conversación', question: 'Tu pregunta',
    notice: 'Solo lectura. Tu pregunta, fragmentos de hasta seis mensajes recientes y los totales habilitados pueden compartirse con el proveedor seleccionado. No escribas nombres, datos de contacto, credenciales ni otra información confidencial.',
    context: 'Intro para enviar. Mayús + Intro para una nueva línea. Recarga para borrar esta conversación.',
    intro: (name, owner) => `Hola ${owner}. Soy ${name}. Pregúntame sobre los totales habilitados del negocio.`,
    suggestion: '¿Qué necesita atención?', placeholder: '¿Cuántas solicitudes de cotización nuevas hay?',
    send: 'Enviar pregunta', waiting: 'Esperando una respuesta…', you: 'Tú', mute: 'Silenciar respuestas', stop: 'Detener lectura',
    settings: 'Abrir configuración', login: 'Iniciar sesión', custom: 'Personalizado', by: 'Respondió',
    errors: {
      not_configured: 'El asistente no está disponible en este entorno.',
      sign_in: 'Tu sesión terminó. Vuelve a iniciar sesión.',
      not_authorized: 'Esta cuenta no tiene acceso de propietario.',
      rate_limited: 'Se alcanzó el límite por minuto o por mes del espacio. Inténtalo más tarde.',
      disabled: 'El asistente está desactivado. Tanto el servidor como la configuración guardada deben permitir su uso.',
      provider_not_set: 'Revisa el proveedor, la clave y el modelo guardados.',
      provider_failed: 'El asistente no pudo completar la solicitud. Inténtalo más tarde.',
      too_large: 'La solicitud es demasiado larga. Acorta la pregunta.',
      invalid: 'Revisa tu pregunta e inténtalo de nuevo.',
      rejected: 'Se rechazó la solicitud. Abre el espacio en su dirección autorizada.',
    },
  },
};

// The server limits history by JS characters, but the entire JSON body by UTF-8 bytes.
// Never split a surrogate pair or drop just one half of a question/reply exchange.
function chatBody(message, language, pairs) {
  const excerpt = text => text.slice(0, 1000).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
  const history = pairs.slice(-3).flatMap(p => [
    { role: 'user', text: excerpt(p.question) }, { role: 'assistant', text: excerpt(p.answer) },
  ]);
  const encoder = new TextEncoder();
  for (;;) {
    const json = JSON.stringify({ message, language, history });
    if (encoder.encode(json).byteLength <= 8192) return json;
    if (!history.length) return null;
    history.splice(0, 2);
  }
}

function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* Playback is optional. */ }
}

function speak(text, lang, rate, pitch, voiceName) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return;
    const line = new window.SpeechSynthesisUtterance(text);
    line.lang = lang;
    line.rate = rate;
    line.pitch = pitch;
    const selected = synth.getVoices().find(v => v.name === voiceName);
    if (selected) line.voice = selected;
    synth.cancel();
    synth.speak(line);
  } catch { /* A speech failure must not turn a successful reply into a chat error. */ }
}

export default function OwnerChat({ enabled, personaName, ownerName, speakReplies, rate, pitch, voiceName }) {
  const [lang, setLang] = useState('en');
  const [input, setInput] = useState('');
  const [pairs, setPairs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const mute = useRef(false), active = useRef(null);
  const locked = error === 'sign_in' || error === 'not_authorized';
  const t = copy[lang];
  const problem = error || (!enabled && 'disabled');

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = previous; };
  }, [lang]);

  useEffect(() => {
    setVoiceReady(!!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function');
    return () => {
      active.current?.abort();
      active.current = null;
      stopSpeaking();
    };
  }, []);

  async function ask(question) {
    const message = question.trim();
    if (!enabled || locked || active.current || !message) return;
    const body = message.length <= 2500 && chatBody(message, lang, pairs);
    if (!body) { setError('too_large'); return; }
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    setInput(message); setBusy(true); setError('');
    try {
      const response = await fetch('/api/owner/assistant', {
        method: 'POST', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
      });
      const data = await response.json();
      if (active.current !== controller) return;
      if (!response.ok) {
        const code = Object.hasOwn(t.errors, data?.error) ? data.error : 'provider_failed';
        if (code === 'sign_in' || code === 'not_authorized') {
          setPairs([]); setInput(''); stopSpeaking();
        }
        setError(code);
        return;
      }
      const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
      const { provider, model } = data?.meta || {};
      if (!answer || !['anthropic', 'custom'].includes(provider) || typeof model !== 'string' || !model) {
        setError('provider_failed');
        return;
      }
      setPairs(old => [...old, { question: message, answer, provider, model, lang }]);
      setInput('');
      if (speakReplies && !mute.current) speak(answer, lang, rate, pitch, voiceName);
    } catch {
      if (active.current === controller) setError('provider_failed');
    } finally {
      clearTimeout(timer);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  return (
    <div className="as-chat-shell" lang={lang}>
      <div className="assistant-language">
        <button className="btn light small" type="button" lang={lang === 'en' ? 'es' : 'en'}
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}>{t.switch}</button>
      </div>
      {problem && <p className="form-error" role="alert">{t.errors[problem]}{' '}
        {problem === 'sign_in' && <a href="/owner/login">{t.login}</a>}
        {['provider_not_set', 'disabled'].includes(problem) && <a href="/owner/assistant/settings">{t.settings}</a>}
      </p>}
      {!locked && <section className="chat-card owner-chat" aria-label={t.title}>
        <div className="chat-message">
          <div className="chat-avatar"><Sparkles size={18} aria-hidden="true" /></div>
          <div><strong>{personaName}</strong><p>{t.intro(personaName, ownerName)}</p></div>
        </div>
        <p className="as-note" id="as-sharing">{t.notice}</p>
        <div role="log" aria-label={t.log} aria-live="polite" aria-relevant="additions">
          {pairs.map((p, i) => <div key={i}>
            <div className="chat-user"><strong>{t.you}: </strong><span lang={p.lang}>{p.question}</span></div>
            <div className="chat-message">
              <div className="chat-avatar"><Sparkles size={18} aria-hidden="true" /></div>
              <div><strong>{personaName}</strong><p className="chat-answer" lang={p.lang}>{p.answer}</p>
                <small>{t.by} {p.provider === 'anthropic' ? 'Anthropic' : t.custom} · {p.model}</small>
              </div>
            </div>
          </div>)}
        </div>
        <button className="suggestion" type="button" disabled={!enabled || busy} onClick={() => ask(t.suggestion)}>{t.suggestion}</button>
        <form method="post" className="as-composer" onSubmit={e => { e.preventDefault(); ask(input); }}>
          <label htmlFor="as-question">{t.question}</label>
          <textarea id="as-question" value={input} maxLength={2500} rows={2} required readOnly={busy} disabled={!enabled}
            enterKeyHint="send" aria-describedby="as-sharing as-keys" placeholder={t.placeholder}
            onChange={e => setInput(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault(); e.currentTarget.form.requestSubmit();
              }
            }} />
          <small id="as-keys">{t.context}</small>
          <div className="as-actions">
            <button className="btn dark" disabled={!enabled || busy || !input.trim()}><Send size={16} aria-hidden="true" />{t.send}</button>
            {speakReplies && voiceReady && <>
              <button className="btn light" type="button" aria-pressed={muted} onClick={() => {
                mute.current = !mute.current; setMuted(mute.current); if (mute.current) stopSpeaking();
              }}><Volume2 size={16} aria-hidden="true" />{t.mute}</button>
              <button className="btn light" type="button" onClick={stopSpeaking}><X size={16} aria-hidden="true" />{t.stop}</button>
            </>}
          </div>
        </form>
        <p className="as-status" role="status">{busy ? t.waiting : ''}</p>
      </section>}
    </div>
  );
}
