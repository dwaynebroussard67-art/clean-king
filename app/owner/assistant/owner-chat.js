'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Globe2, Send, ShieldCheck, Sparkles } from 'lucide-react';
import SettingsPanel from './settings-panel';
import './settings.css';

const base = '/api/owner/assistant';
const problems = {
  not_configured: ['The owner assistant is not configured for this workspace.', 'El asistente no está configurado para este espacio.'],
  sign_in: ['Your session ended. Please sign in again.', 'Tu sesión terminó. Vuelve a iniciar sesión.'],
  not_authorized: ['This account does not have owner access.', 'Esta cuenta no tiene acceso de dueño.'],
  rejected: ['This request was rejected. Reopen the workspace at its approved address.', 'Se rechazó la solicitud. Abre el espacio en su dirección autorizada.'],
  rate_limited: ['The workspace reached its minute or monthly limit. Try again later.', 'Se alcanzó el límite por minuto o por mes del espacio. Inténtalo más tarde.'],
  disabled: ['The owner assistant is switched off.', 'El asistente del dueño está desactivado.'],
  provider_not_set: ['The selected provider needs a key and a model before it can answer.', 'El proveedor seleccionado necesita una clave y un modelo para responder.'],
  provider_failed: ['The assistant could not complete the request. Please try again later.', 'El asistente no pudo completar la solicitud. Inténtalo más tarde.'],
  too_large: ['This request is too large. Try a shorter question.', 'La solicitud es demasiado larga. Acorta la pregunta.'],
  invalid: ['Please check the highlighted fields or shorten your question.', 'Revisa los campos indicados o acorta tu pregunta.'],
  encryption_not_ready: ['Key storage is not ready. Ask the administrator to configure encryption.', 'No se pueden guardar claves. Pide al administrador que configure el cifrado.'],
  conflict: ['Settings changed elsewhere. Reload the latest settings before saving.', 'La configuración cambió en otro lugar. Carga la versión más reciente antes de guardar.'],
};

function Problem({ code, t }) {
  if (!code) return null;
  const words = Object.hasOwn(problems, code) ? problems[code] : problems.provider_failed;
  return (
    <p role="alert" className="as-problem">
      {t(...words)}{' '}
      {code === 'sign_in' && <a href="/owner/login">{t('Sign in', 'Iniciar sesión')}</a>}
      {['disabled', 'provider_not_set'].includes(code) &&
        <a href="#as-settings">{t('Open settings', 'Abrir configuración')}</a>}
    </p>
  );
}

async function request(method, suffix, payload) {
  try {
    const response = await fetch(base + suffix, {
      method, mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout?.(35000),
    });
    const data = await response.json();
    if (response.ok) return { data };
    return {
      error: Object.hasOwn(problems, data?.error) ? data.error : 'provider_failed',
      paths: response.status === 422 && Array.isArray(data?.errors) ? data.errors.map(e => e?.path) : [],
    };
  } catch {
    return { error: 'provider_failed' };
  }
}

// Keep complete, successful question/reply pairs only. Bytes, not characters, govern the wire limit.
function chatBody(message, language, pairs) {
  const excerpt = text => text.slice(0, 1000).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
  const history = pairs.slice(-3).flatMap(pair => [
    { role: 'user', text: excerpt(pair.question) }, { role: 'assistant', text: excerpt(pair.answer) },
  ]);
  const payload = { message, language, history };
  const encoder = new TextEncoder();
  while (encoder.encode(JSON.stringify(payload)).length > 8192) {
    if (!history.length) return null;
    history.splice(0, 2);
  }
  return payload;
}

function stopSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* Speech is optional. */ }
}

function speak(text, voice, language) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return;
    const line = new window.SpeechSynthesisUtterance(text);
    line.lang = language;
    line.rate = voice.rate;
    line.pitch = voice.pitch;
    const chosen = synth.getVoices().find(v => v.name === voice.voiceName);
    if (chosen) line.voice = chosen;
    synth.cancel();
    synth.speak(line);
  } catch { /* Never fail a chat or a settings save because speech is unavailable. */ }
}

export default function OwnerChat({ initial }) {
  const [lang, setLang] = useState('en');
  const t = (en, es) => lang === 'es' ? es : en;
  const [workspace, setWorkspace] = useState(initial);
  const [pairs, setPairs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [voices, setVoices] = useState([]);
  const [speechReady, setSpeechReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const mute = useRef(false), sending = useRef(false), mounted = useRef(false);
  const conversation = useRef(0);
  const settings = workspace.settings;
  const voice = useRef(settings?.voice);

  useEffect(() => {
    const old = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = old; };
  }, [lang]);

  useEffect(() => {
    mounted.current = true;
    const synth = window.speechSynthesis;
    const supported = !!synth && !!window.SpeechSynthesisUtterance;
    setSpeechReady(supported);
    function refreshVoices() {
      try { setVoices([...new Set(synth.getVoices().map(v => v.name).filter(n => n && n.length <= 100))]); }
      catch { setVoices([]); }
    }
    if (supported) {
      refreshVoices();
      synth.addEventListener?.('voiceschanged', refreshVoices);
    }
    return () => {
      mounted.current = false;
      synth?.removeEventListener?.('voiceschanged', refreshVoices);
      stopSpeech();
    };
  }, []);

  async function ownerRequest(method, suffix, payload) {
    const result = await request(method, suffix, payload);
    if (mounted.current && ['sign_in', 'not_authorized'].includes(result.error)) {
      conversation.current++;
      stopSpeech();
      setInput(''); setPairs([]);
      setWorkspace({ error: result.error });
    }
    return result;
  }

  function updateWorkspace(patch) {
    if (patch.settings) {
      const next = patch.settings;
      if (!next.enabled || JSON.stringify(next.capabilities) !== JSON.stringify(settings.capabilities) ||
          JSON.stringify(next.provider) !== JSON.stringify(settings.provider)) {
        // Don't replay a previous provider's conversation or counts the owner just hid.
        conversation.current++;
        setPairs([]);
        stopSpeech();
      }
      voice.current = next.voice;
      if (!next.voice.speakReplies) stopSpeech();
    }
    setProblem('');
    setWorkspace(w => w.settings ? { ...w, ...patch } : w);
  }

  async function ask(event) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending.current || !settings?.enabled) return;
    const epoch = conversation.current;
    const body = message.length <= 2500 && chatBody(message, lang, pairs);
    if (!body) { setProblem('too_large'); return; }
    sending.current = true;
    setBusy(true);
    setProblem('');
    try {
      const { data, error } = await ownerRequest('POST', '', body);
      if (!mounted.current || epoch !== conversation.current) return;
      if (error || typeof data?.answer !== 'string' || !data.answer.trim() || !['anthropic', 'custom'].includes(data?.meta?.provider) ||
          typeof data.meta.model !== 'string') {
        setProblem(error || 'provider_failed');
        return;
      }
      setPairs(old => [...old, { question: message, answer: data.answer, meta: data.meta, lang, name: settings.persona.name }]);
      setInput('');
      if (voice.current.speakReplies && !mute.current) speak(data.answer, voice.current, lang);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div lang={lang} className="as-workspace">
      <div className="as-toolbar">
        <a href="/owner"><ArrowLeft size={16} aria-hidden="true" />{t('Owner inbox', 'Bandeja del dueño')}</a>
        <button type="button" lang={t('es', 'en')} onClick={() => setLang(t('es', 'en'))}>
          <Globe2 size={16} aria-hidden="true" />{t('Español', 'English')}
        </button>
      </div>
      <header className="as-heading">
        <p className="as-kicker">{t('OWNER WORKSPACE', 'ESPACIO DEL DUEÑO')}</p>
        <h1>{t('Owner assistant', 'Asistente del dueño')}</h1>
        <p>{t('Ask about your totals. You decide which counts to share.', 'Consulta tus totales. Tú decides qué cifras compartir.')}</p>
      </header>
      {!settings ? <Problem code={workspace.error} t={t} /> : <>
        <section className="as-card" aria-labelledby="as-chat-title">
          <div className="as-chat-heading">
            <h2 id="as-chat-title"><Sparkles size={22} aria-hidden="true" />{settings.persona.name}</h2>
            <span className="as-pill"><ShieldCheck size={15} aria-hidden="true" />{t('Read only', 'Solo lectura')}</span>
          </div>
          <p>{t('No messages, hiring decisions or schedule changes. Never enter names, contact details, passwords, student or patient information.',
            'No envía mensajes, no toma decisiones de contratación ni cambia horarios. No escribas nombres, datos de contacto, contraseñas ni datos de estudiantes o pacientes.')}</p>
          <p className="as-note" id="as-sharing">{t('Your question, up to six recent messages and the enabled counts are sent to the selected provider. This chat clears on reload.',
            'Tu pregunta, hasta seis mensajes recientes y los totales habilitados se envían al proveedor seleccionado. Al recargar se borra este chat.')}</p>
          <div role="log" aria-live="polite" aria-label={t('Conversation', 'Conversación')} className="as-transcript">
            {pairs.map((p, i) => <div key={i} className="as-pair">
              <div className="as-question"><strong>{t('You', 'Tú')}</strong><p lang={p.lang}>{p.question}</p></div>
              <div className="as-answer"><strong>{p.name}</strong><p lang={p.lang}>{p.answer}</p>
                <small>{t('Answered by', 'Respondió')} {p.meta.provider === 'anthropic' ? 'Anthropic' : t('Custom', 'Personalizado')} · {p.meta.model}</small>
              </div>
            </div>)}
          </div>
          <form method="post" onSubmit={ask} className="as-composer">
            <label htmlFor="as-message">{t('Your question', 'Tu pregunta')}</label>
            <textarea id="as-message" rows={2} maxLength={2500} value={input} required disabled={!settings.enabled || busy}
              aria-describedby="as-sharing as-keys" enterKeyHint="send" onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault(); e.currentTarget.form.requestSubmit();
                }
              }} placeholder={t('How many new quote requests are there?', '¿Cuántas solicitudes de cotización nuevas hay?')} />
            <small id="as-keys">{t('Enter to send. Shift + Enter for a new line.', 'Intro para enviar. Mayús + Intro para una nueva línea.')}</small>
            <div className="as-actions">
              <button className="as-primary" disabled={!settings.enabled || busy || !input.trim()}>
                <Send size={16} aria-hidden="true" />{t('Send question', 'Enviar pregunta')}
              </button>
              {speechReady && <>
                <button type="button" aria-pressed={muted} onClick={() => {
                  mute.current = !mute.current; setMuted(mute.current); if (mute.current) stopSpeech();
                }}>{t('Mute replies', 'Silenciar respuestas')}</button>
                <button type="button" onClick={stopSpeech}>{t('Stop voice', 'Detener voz')}</button>
              </>}
            </div>
          </form>
          <p role="status" className="as-status">{busy && t('Waiting for a reply…', 'Esperando la respuesta…')}</p>
          <Problem code={problem || (!settings.enabled && 'disabled')} t={t} />
        </section>
        <SettingsPanel workspace={workspace} updateWorkspace={updateWorkspace} t={t} request={ownerRequest}
          problemView={code => <Problem code={code} t={t} />} voices={voices} speechReady={speechReady}
          preview={v => speak(t('This is a voice preview.', 'Esta es una prueba de voz.'), v, lang)} />
      </>}
    </div>
  );
}
