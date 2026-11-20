'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';

const copy = {
  en: {
    title: 'Your assistant',
    switch: 'Español',
    disabled: 'The owner assistant is turned off. Change its settings to enable it.',
    notice: 'Read-only assistant. It sees enabled aggregate counts only. Do not enter personal or sensitive information.',
    context: 'Your recent messages may be included with your next question.',
    intro: (name, owner) => `Hello ${owner}. I’m ${name}. Ask me about the enabled business counts.`,
    suggestion: 'What needs attention?',
    placeholder: 'Ask a question…',
    send: 'Send',
    waiting: 'Thinking…',
    assistant: 'Assistant',
    you: 'You',
    mute: 'Mute voice',
    unmute: 'Unmute voice',
    stop: 'Stop speaking',
    by: (provider, model) => `Answered by ${provider} · ${model}`,
    errors: {
      not_configured: 'The assistant is unavailable in this environment.',
      sign_in: 'Please sign in to continue.',
      not_authorized: 'This account is not authorized to use the owner assistant.',
      rate_limited: 'The request limit has been reached. Try again later.',
      disabled: 'The assistant is turned off. Review its settings.',
      provider_not_set: 'A provider key or model is missing. Review the settings.',
      provider_failed: 'The assistant provider could not answer. Try again later.',
      too_large: 'That request is too long. Shorten it and try again.',
      invalid: 'Check your message and try again.',
      rejected: 'The request was rejected. Refresh the page and try again.',
    },
  },
  es: {
    title: 'Tu asistente',
    switch: 'English',
    disabled: 'El asistente del propietario está desactivado. Revisa la configuración para activarlo.',
    notice: 'Asistente de solo lectura. Solo ve los totales habilitados. No ingreses información personal ni confidencial.',
    context: 'Tus mensajes recientes pueden incluirse con tu próxima pregunta.',
    intro: (name, owner) => `Hola ${owner}. Soy ${name}. Pregúntame sobre los totales habilitados del negocio.`,
    suggestion: '¿Qué necesita atención?',
    placeholder: 'Haz una pregunta…',
    send: 'Enviar',
    waiting: 'Pensando…',
    assistant: 'Asistente',
    you: 'Tú',
    mute: 'Silenciar voz',
    unmute: 'Activar voz',
    stop: 'Detener lectura',
    by: (provider, model) => `Respondió ${provider} · ${model}`,
    errors: {
      not_configured: 'El asistente no está disponible en este entorno.',
      sign_in: 'Inicia sesión para continuar.',
      not_authorized: 'Esta cuenta no tiene autorización para usar el asistente del propietario.',
      rate_limited: 'Se alcanzó el límite de solicitudes. Inténtalo más tarde.',
      disabled: 'El asistente está desactivado. Revisa su configuración.',
      provider_not_set: 'Falta una clave o modelo del proveedor. Revisa la configuración.',
      provider_failed: 'El proveedor no pudo responder. Inténtalo más tarde.',
      too_large: 'La solicitud es demasiado larga. Acórtala e inténtalo de nuevo.',
      invalid: 'Revisa tu mensaje e inténtalo de nuevo.',
      rejected: 'Se rechazó la solicitud. Actualiza la página e inténtalo de nuevo.',
    },
  },
};

export default function OwnerChat({ enabled, personaName, ownerName, speakReplies, rate, pitch, voiceName }) {
  const [lang, setLang] = useState('en');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const conversation = useRef([]);
  const t = copy[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = 'en'; };
  }, [lang]);

  function stopSpeaking() {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function speak(text) {
    if (!speakReplies || muted || typeof window === 'undefined' || !window.speechSynthesis ||
        typeof window.SpeechSynthesisUtterance !== 'function') return;
    stopSpeaking();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = pitch;
    const available = window.speechSynthesis.getVoices();
    const selected = voiceName && available.find((voice) => voice.name === voiceName);
    if (selected) utterance.voice = selected;
    window.speechSynthesis.speak(utterance);
  }

  async function ask(question) {
    const message = question.trim();
    if (!message || message.length > 2500 || busy || !enabled) return;
    setError('');
    setBusy(true);
    setInput('');
    setMessages((old) => [...old, { role: 'user', text: message }]);
    try {
      const history = conversation.current.slice(-6);
      const response = await fetch('/api/owner/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, language: lang, history }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error || 'provider_failed');
        return;
      }
      const answer = typeof body.answer === 'string' ? body.answer : '';
      conversation.current = [...history, { role: 'user', text: message }, { role: 'assistant', text: answer }].slice(-6);
      setMessages((old) => [...old, {
        role: 'assistant',
        text: answer,
        meta: body.meta,
      }]);
      speak(answer);
    } catch {
      setError('provider_failed');
    } finally {
      setBusy(false);
    }
  }

  const errorCode = Object.hasOwn(t.errors, error) ? error : 'provider_failed';
  const signInError = errorCode === 'sign_in';
  const settingsError = ['disabled', 'provider_not_set', 'not_configured'].includes(errorCode);
  const providerNames = { anthropic: 'Anthropic', custom: 'Custom / Personalizado' };

  return (
    <>
      <div className="assistant-language">
        <button className="btn light small" type="button" onClick={() => setLang(lang === 'en' ? 'es' : 'en')}>{t.switch}</button>
      </div>
      <p className="inline-notice">{enabled ? t.notice : t.disabled}</p>
      <section className="chat-card owner-chat" aria-label={t.title}>
        <div className="chat-message">
          <div className="chat-avatar"><Sparkles size={18} aria-hidden="true" /></div>
          <div><strong>{personaName}</strong><p>{t.intro(personaName, ownerName)}</p></div>
        </div>
        <div aria-live="polite" aria-relevant="additions text">
          {messages.map((item, index) => item.role === 'user'
            ? <div key={index} className="chat-user"><strong>{t.you}: </strong>{item.text}</div>
            : <div key={index} className="chat-message">
              <div className="chat-avatar"><Sparkles size={18} aria-hidden="true" /></div>
              <div>
                <strong>{personaName}</strong>
                <p className="chat-answer">{item.text}</p>
                {item.meta?.provider && item.meta?.model && <small>{t.by(providerNames[item.meta.provider] || item.meta.provider, item.meta.model)}</small>}
              </div>
            </div>)}
        </div>
        {error && <p className="form-error" role="alert">
          {t.errors[errorCode]}{' '}
          {signInError && <a href="/owner/login">Sign in / Iniciar sesión</a>}
          {settingsError && <a href="/owner/assistant/settings">Settings / Configuración</a>}
        </p>}
        <button className="suggestion" type="button" disabled={!enabled || busy} onClick={() => ask(t.suggestion)}>{t.suggestion}</button>
        <form className="chat-form" onSubmit={(event) => { event.preventDefault(); ask(input); }}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={2500}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            disabled={!enabled || busy}
          />
          <button type="submit" disabled={!enabled || busy || !input.trim()} aria-label={t.send}><Send size={18} aria-hidden="true" /></button>
        </form>
        <p className="assistant-context" aria-live="polite">{busy ? t.waiting : t.context}</p>
        {speakReplies && <div className="assistant-voice-controls">
          <button type="button" className="btn light small" onClick={() => setMuted((value) => !value)} aria-pressed={muted}>
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}{' '}{muted ? t.unmute : t.mute}
          </button>
          <button type="button" className="btn light small" onClick={stopSpeaking}><X size={16} aria-hidden="true" /> {t.stop}</button>
        </div>}
      </section>
    </>
  );
}
