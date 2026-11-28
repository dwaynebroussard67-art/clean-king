'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import BubblesBackground, { CharacterBubble } from '../../lib/bubbles-bg';
import './pitch.css';

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function chapterSrc(n) {
  return `/pitch/audio/chapter-${String(n).padStart(2, '0')}.mp3`;
}

/**
 * BubblesAvatar renders the EXACT Meta AI asset file when one is listed in
 * lib/pitch/meta-ai-assets.mjs. No lookalike, no screenshot, no copy.
 * Until those exact files land, it renders the repo's real CharacterBubble
 * component (lib/bubbles-bg.js) — the same avatar the app already ships.
 */
function BubblesAvatar({ assets, thinking }) {
  const [failed, setFailed] = useState([]);
  const exact = assets.find((a) => a.role === 'avatar')
    || assets.find((a) => a.role === 'motion' || a.kind === 'video')
    || null;

  if (exact && !failed.includes(exact.file)) {
    const url = `/meta-ai/${exact.file}`;
    const onError = () => setFailed((f) => [...f, exact.file]);
    if (exact.kind === 'video') {
      return (
        <video
          className="pitch-avatar-exact"
          src={url}
          autoPlay
          loop
          muted
          playsInline
          aria-label={exact.label || 'Bubbles — exact Meta AI asset'}
          onError={onError}
        />
      );
    }
    return (
      <img
        className="pitch-avatar-exact"
        src={url}
        alt={exact.label || 'Bubbles — exact Meta AI asset'}
        onError={onError}
      />
    );
  }

  return (
    <div className="pitch-char" title="Bubbles — real CharacterBubble from lib/bubbles-bg.js">
      <CharacterBubble thinking={thinking} />
    </div>
  );
}

export default function PitchClient({ chapters, meta, facts, durations, metaAiAssets }) {
  const audioRef = useRef(null);
  const transcriptRef = useRef(null);
  const [mode, setMode] = useState('full');
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durations.reduce((a, b) => a + b, 0));

  const total = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);
  const starts = useMemo(() => {
    let acc = 0;
    return durations.map((d) => { const s = acc; acc += d; return s; });
  }, [durations]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) { a.src = meta.audioFull; a.load(); }
  }, [meta.audioFull]);

  // Keep the transcript pinned to the chapter that is being spoken.
  useEffect(() => {
    const box = transcriptRef.current;
    if (!box || !playing) return;
    const el = box.querySelector(`[data-chapter-index="${active}"]`);
    if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - 18), behavior: 'smooth' });
  }, [active, playing]);

  function setSource(src, nextMode, index) {
    const a = audioRef.current;
    if (!a) return;
    a.src = src;
    a.currentTime = 0;
    setMode(nextMode);
    setActive(index);
    setTime(0);
    setDuration(nextMode === 'full' ? total : durations[index]);
    const p = a.play();
    if (p?.catch) p.catch(() => setPlaying(false));
  }

  function playAll() { setSource(meta.audioFull, 'full', 0); }
  function playChapter(i) { setSource(chapterSrc(chapters[i].n), 'chapter', i); }

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { const p = a.play(); if (p?.catch) p.catch(() => {}); }
    else a.pause();
  }

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a) return;
    const t = a.currentTime;
    setTime(t);
    if (mode === 'full') {
      let idx = 0;
      for (let i = 0; i < starts.length; i += 1) if (t >= starts[i]) idx = i;
      setActive(idx);
    }
  }

  function seek(e) {
    if (mode !== 'full') return;
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * (a.duration || total);
    setTime(a.currentTime);
  }

  const pct = Math.min(100, (time / (duration || 1)) * 100);
  const exactAvatar = metaAiAssets.find((a) => a.role === 'avatar') || null;

  return (
    <main className="pitch-root">
      {/* The real animated Bubbles field from lib/bubbles-bg.js, enabled here. */}
      <BubblesBackground count={16} scrubs={4} className="page-bubbles pitch-bg" enabled />

      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); if (mode === 'full') setTime(total); }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={onTimeUpdate}
      />

      <header className="pitch-hero">
        <div className="pitch-hero-inner">
          <div className="pitch-eyebrow"><span className="pitch-dot" />{meta.eyebrow}</div>
          <h1>{meta.title}</h1>
          <p className="pitch-tagline">{meta.tagline}</p>
          <p className="pitch-deck">You have {meta.investment} to place. Ten minutes. No roadmaps, no &ldquo;one day&rdquo;, no hockey-stick graph — only what this repository does today.</p>

          <div className="pitch-hero-row">
            <BubblesAvatar assets={metaAiAssets} thinking={playing} />
            <div className="pitch-hero-copy">
              <div className="pitch-narrator">NARRATED BY <strong>{meta.narrator}</strong> <span>· the real character in this repo</span></div>
              <div className="pitch-hero-actions">
                <button type="button" className="pitch-play-main" onClick={playAll}>
                  <span aria-hidden="true">▶</span> Play the 10-minute pitch
                </button>
                <a className="pitch-ghost" href={meta.site} target="_blank" rel="noreferrer">Open the live site ↗</a>
              </div>
              <p className="pitch-hint">That bubble in the corner is the real <code>BubblesWidget</code>. Tap it and ask her anything. Spacebar toggles playback.</p>
            </div>
          </div>
        </div>
      </header>

      <section className="pitch-facts" aria-label="Verified facts">
        <div className="pitch-facts-head"><span>THE RECEIPTS</span><small>verified in this checkout + the live Vercel / Supabase projects</small></div>
        <div className="pitch-facts-grid">
          {facts.map((f) => (
            <div className="pitch-fact" key={f.label}>
              <strong>{f.value}</strong>
              <span>{f.label}</span>
              <p>{f.detail}</p>
              <code>{f.receipt}</code>
            </div>
          ))}
        </div>
      </section>

      <div className="pitch-body">
        <aside className="pitch-rail" aria-label="Chapters">
          <div className="pitch-rail-head">TEN CHAPTERS <span>{clock(total)}</span></div>
          {chapters.map((c, i) => (
            <button
              type="button"
              key={c.id}
              className={`pitch-chapter-btn ${active === i ? 'is-active' : ''}`}
              onClick={() => playChapter(i)}
            >
              <span className="pitch-ch-num">{String(c.n).padStart(2, '0')}</span>
              <span className="pitch-ch-text"><strong>{c.title}</strong><small>{c.kicker}</small></span>
              <span className="pitch-ch-play" aria-hidden="true">{active === i && playing ? '❚❚' : '▶'}</span>
            </button>
          ))}
          <button type="button" className="pitch-rail-all" onClick={playAll}>▶ Play all ten chapters</button>
        </aside>

        <section className="pitch-transcript" ref={transcriptRef} aria-label="Full transcript">
          {chapters.map((c, i) => (
            <article
              key={c.id}
              id={`chapter-${c.id}`}
              data-chapter-index={i}
              className={`pitch-chapter ${active === i ? 'is-active' : ''}`}
              onClick={() => { if (active !== i) playChapter(i); }}
            >
              <div className="pitch-chapter-top">
                <span className="pitch-chapter-n">{String(c.n).padStart(2, '0')} / 10</span>
                <h2>{c.title}</h2>
                <span className="pitch-chapter-time">{c.kicker}</span>
              </div>
              <p className="pitch-chapter-text">{c.text}</p>
              <div className="pitch-receipts">
                <span>BACKED BY</span>
                {c.receipts.map((r) => <code key={r}>{r}</code>)}
              </div>
            </article>
          ))}
        </section>
      </div>

      <section className="pitch-assets">
        <div className="pitch-assets-card">
          <div className="pitch-assets-head"><span className="pitch-dot" /> BUBBLES · THE ASSET ITSELF</div>
          <h2>{metaAiAssets.length === 0 ? 'Not a picture. Not a screenshot. A loading dock.' : 'Your exact Meta AI files are live here.'}</h2>
          {metaAiAssets.length === 0 ? (
            <>
              <p>I checked the whole repo. The only images are the nine <code>.webp</code> photos in <code>public/images/</code>. Bubbles herself is <em>code</em> — the <code>CharacterBubble</code> avatar in <code>lib/bubbles-bg.js</code>, the floating <code>BubblesWidget</code> in <code>app/public/bubbles-widget.js</code>, and her personality in <code>lib/bubbles-persona.mjs</code>. The Meta AI ad files you&apos;re about to drop in are not in this checkout yet.</p>
              <p className="pitch-assets-strong">So I did not generate a lookalike, a copy, or a screenshot of one. That would be exactly what you said you didn&apos;t want.</p>
              <ol>
                <li>Drop the <strong>exact</strong> Meta AI files into <code>public/meta-ai/</code>, filenames unchanged.</li>
                <li>List each verbatim filename in <code>lib/pitch/meta-ai-assets.mjs</code> with role <code>avatar</code> or <code>motion</code>.</li>
                <li>Reload <code>/pitch</code>. The hero renders <strong>that exact file</strong> at <code>/meta-ai/&lt;filename&gt;</code> — byte for byte, <code>&lt;img&gt;</code> or <code>&lt;video&gt;</code>, nothing re-encoded.</li>
              </ol>
              <p className="pitch-assets-foot">Until then, the avatar above is the real <code>CharacterBubble</code> component, imported directly from this repo. She splits into a thinking cluster while the pitch plays. Same asset, no copy.</p>
            </>
          ) : (
            <>
              <p>{metaAiAssets.length} exact file(s) are wired in. The hero is rendering them directly, with no re-encoding or substitution.</p>
              <div className="pitch-receipts">
                {metaAiAssets.map((a) => <code key={a.file}>/meta-ai/{a.file} · {a.role}</code>)}
              </div>
            </>
          )}
          <div className="pitch-assets-status">
            STATUS: {exactAvatar ? `EXACT ASSET → ${exactAvatar.file}` : '0 EXACT FILES LANDED · REAL REPO BUBBLES IN USE'}
          </div>
        </div>
      </section>

      <section className="pitch-verify">
        <h2>Verify every claim in an afternoon.</h2>
        <div className="pitch-verify-grid">
          <div><code>npm test</code><p>183 passing tests · 48 files</p></div>
          <div><code>npm run build</code><p>24 routes, clean production build</p></div>
          <div><code>git diff --stat</code><p>read the code behind the claims</p></div>
          <div><a href={meta.site} target="_blank" rel="noreferrer">open the live site ↗</a><p>the running product, not a mockup</p></div>
        </div>
        <p className="pitch-verify-note">What this pitch deliberately does <strong>not</strong> claim: customers, revenue, passkeys, SMS sending, or a scheduling engine. Those are documented as gates in the repo. That line between shipped and planned is the point.</p>
        <p className="pitch-verify-note">Counted exactly: <strong>24 product routes</strong> = 11 API endpoints + 13 pages (the build prints 26 rows including <code>/_not-found</code> and this ad). <strong>13,718 lines</strong> of product code. <strong>23 fail-closed switches</strong> = 22 env variables in <code>.env.example</code> plus the owner <code>settings.enabled</code> switch. <strong>Nine</strong> <code>.webp</code> photos. Full definitions are in <a href="/INVESTOR_PITCH.md">INVESTOR_PITCH.md</a>.</p>
        <a className="pitch-doc-link" href="/INVESTOR_PITCH.md">Read the full written pitch (INVESTOR_PITCH.md) ↗</a>
      </section>

      <footer className="pitch-footer">
        <span>{meta.eyebrow.split(" · ")[0]} · {meta.investment} INVESTOR BRIEF</span>
        <span>Be sweet. Be sharp. Tell the truth. Get things done.</span>
      </footer>

      <div className="pitch-player">
        <button type="button" className="pitch-player-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="pitch-player-info">
          <strong>{String(chapters[active].n).padStart(2, '0')} · {chapters[active].title}</strong>
          <span>{clock(time)} / {clock(duration)} · {mode === 'full' ? 'Full pitch' : 'Single chapter'}</span>
        </div>
        <div
          className="pitch-progress"
          onClick={seek}
          role="slider"
          tabIndex={0}
          aria-label="Pitch progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          title={mode === 'full' ? 'Click to seek' : 'Switch to Play all to seek'}
        >
          <div className="pitch-progress-fill" style={{ width: `${pct}%` }} />
          {mode === 'full' && starts.slice(1).map((s, i) => (
            <span key={i} className="pitch-progress-tick" style={{ left: `${(s / total) * 100}%` }} />
          ))}
        </div>
        <button type="button" className="pitch-player-all" onClick={playAll}>Play all</button>
      </div>
    </main>
  );
}
