'use client';

import { useEffect, useRef, useState } from 'react';
import { brand } from '../../lib/brand.mjs';
import { Mic, MicOff, Send, Volume2, VolumeX, X } from 'lucide-react';

export default function BubblesWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'bubbles',
      text: "Hey boss! I'm Bubbles. Tap the mic or type anything—I can check your applicants, quotes, onboarding, or walk you through this page.",
    },
  ]);

  const recognitionRef = useRef(null);

  function speakText(text) {
    if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.04;
      utter.pitch = 1.08;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on unsupported browsers
    }
  }

  function stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  function toggleMic() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages(m => [...m, { role: 'bubbles', text: 'Voice input is not supported in this browser—type below and I will still speak back!' }]);
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) {
        setInput(transcript);
        handleSend(transcript);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function handleSend(overrideText) {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setBusy(true);

    try {
      // Check if it's a quick action command
      const lower = text.toLowerCase();
      let action = null;
      if (lower.includes('applicant') || lower.includes('hiring')) action = 'list_applicants';
      else if (lower.includes('quote') || lower.includes('lead')) action = 'list_quotes';
      else if (lower.includes('onboard')) action = 'list_onboarding';
      else if (lower.includes('memor') || lower.includes('remember')) action = 'recall_memories';
      else if (lower.includes('brief') || lower.includes('morning') || lower.includes('today')) action = 'get_briefing';

      if (action) {
        const res = await fetch(`/api/owner/assistant/actions?action=${encodeURIComponent(action)}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.message) {
            setMessages(m => [...m, { role: 'bubbles', text: data.message }]);
            speakText(data.message);
            setBusy(false);
            return;
          }
        }
      }

      // Fallback to /api/owner/assistant
      const res = await fetch('/api/owner/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, language: 'en', history: [] }),
      });
      const data = await res.json().catch(() => null);
      const reply = data?.answer || data?.message || "I'm here, boss! Open the Assistant tab for full controls, or ask me about applicants, quotes, or onboarding.";
      setMessages(m => [...m, { role: 'bubbles', text: reply }]);
      speakText(reply);
    } catch {
      const err = 'Had a hiccup reaching the server, boss. Try again in a second.';
      setMessages(m => [...m, { role: 'bubbles', text: err }]);
      speakText(err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  return (
    <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999, fontFamily: 'system-ui, sans-serif' }}>
      {open && (
        <div
          role="dialog"
          aria-label="Bubbles Assistant"
          style={{
            width: '340px',
            maxWidth: 'calc(100vw - 32px)',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            boxShadow: '0 20px 45px rgba(0,0,0,0.18)',
            marginBottom: '12px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ background: '#111827', color: '#fff', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '14px', height: '14px', borderRadius: '50%', display: 'inline-block',
                background: 'radial-gradient(circle at 30% 30%, #ffffff, #67e8f9 45%, #a855f7 90%)',
                boxShadow: '0 0 8px rgba(103,232,249,0.7)',
              }} />
              <strong style={{ fontSize: '14px' }}>Bubbles · {brand.name}</strong>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                aria-label={muted ? 'Unmute Bubbles' : 'Mute Bubbles'}
                onClick={() => { setMuted(m => { if (!m) stopSpeaking(); return !m; }); }}
                style={{ background: 'transparent', border: 'none', color: '#d1d5db', cursor: 'pointer', padding: '4px' }}
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <button
                type="button"
                aria-label="Close Bubbles"
                onClick={() => setOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#d1d5db', cursor: 'pointer', padding: '4px' }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div style={{ maxHeight: '260px', overflowY: 'auto', padding: '12px', display: 'grid', gap: '8px', background: '#f9fafb' }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'end' : 'start',
                  background: m.role === 'user' ? '#111827' : '#ffffff',
                  color: m.role === 'user' ? '#ffffff' : '#111827',
                  border: m.role === 'user' ? 'none' : '1px solid #e5e7eb',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  fontSize: '13px',
                  lineHeight: 1.4,
                  maxWidth: '88%',
                  justifySelf: m.role === 'user' ? 'end' : 'start',
                }}
              >
                {m.text}
              </div>
            ))}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); handleSend(); }}
            style={{ display: 'flex', gap: '6px', padding: '10px', borderTop: '1px solid #e5e7eb', background: '#fff' }}
          >
            <button
              type="button"
              onClick={toggleMic}
              aria-label={listening ? 'Stop listening' : 'Speak to Bubbles'}
              style={{
                background: listening ? '#dc2626' : '#f3f4f6',
                color: listening ? '#fff' : '#111827',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={listening ? 'Listening...' : 'Ask Bubbles...'}
              disabled={busy}
              style={{
                flex: 1,
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '8px 10px',
                fontSize: '13px',
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              style={{
                background: '#111827',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Open Bubbles Assistant"
        style={{
          width: '58px',
          height: '58px',
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.85)',
          background: 'radial-gradient(circle at 30% 28%, rgba(255,255,255,0.95) 0%, rgba(103,232,249,0.75) 35%, rgba(168,85,247,0.8) 75%, rgba(59,130,246,0.9) 100%)',
          boxShadow: '0 8px 25px rgba(103, 232, 249, 0.45), inset 0 -4px 10px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#111827',
          fontWeight: 700,
          fontSize: '12px',
          letterSpacing: '0.02em',
        }}
      >
        {open ? <X size={22} color="#111827" /> : 'Bubbles'}
      </button>
    </div>
  );
}
