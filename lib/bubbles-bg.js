'use client';

import { useEffect, useState } from 'react';

/**
 * BubblesBackground — renders a field of animated, floating bubbles plus
 * scrubbing bubble characters that drift across the container.
 *
 * Props:
 *   count — number of float bubbles (default 18)
 *   scrubs — number of scrubbing bubbles (default 4)
 *   className — extra CSS class
 */
/**
 * CharacterBubble — the AI's bubble persona.
 *
 * Props:
 *   thinking — when true, the single bubble splits into a vibrating cluster
 *   className — extra CSS class
 *
 * She is one bubble at rest. When she starts thinking she splits into
 * a cluster of bubbles that vibrate, change color, and pulse — just like
 * an AI going through its thinking process.
 */
export function CharacterBubble({ thinking = false, className = '' }) {
  const nodeCount = 5;
  return (
    <div
      className={`char-bubble ${className} ${thinking ? 'thinking' : ''}`}
      aria-label={thinking ? 'thinking' : 'idle'}
      aria-hidden="true"
    >
      <div className="char-bubble-idle" />
      {thinking && (
        <div className="char-bubble-nodes">
          {Array.from({ length: nodeCount }, (_, i) => (
            <div key={i} className="char-bubble-node" />
          ))}
          <div className="char-bubble-thought" />
        </div>
      )}
      {/* Visually hidden live region for screen-reader thinking feedback */}
      <span className="sr-only" aria-live="polite">
        {thinking ? 'Bubbles is thinking' : 'Bubbles replied'}
      </span>
    </div>
  );
}

/**
 * BubblesBackground — renders a field of animated, floating bubbles plus
 * scrubbing bubble characters that drift across the container.
 *
 * Props:
 *   count — number of float bubbles (default 18)
 *   scrubs — number of scrubbing bubbles (default 4)
 *   className — extra CSS class
 *   contained — when true, positions bubbles inside its parent using cqh units
 *               instead of viewport units (for service cards)
 */
export default function BubblesBackground({ count = 18, scrubs = 4, className = '', contained = false }) {
  const [bubbles, setBubbles] = useState([]);
  const [scrubsArr, setScrubs] = useState([]);

  useEffect(() => {
    const rand = (min, max) => Math.random() * (max - min) + min;

    const makeBubble = (i) => {
      const size = contained ? rand(12, 40) : rand(24, 120);
      const x = rand(0, 100);
      const startY = contained ? rand(80, 120) : rand(100, 110);
      const endY = contained ? rand(-80, -10) : rand(-120, -20);
      const duration = contained ? rand(3, 7) : rand(6, 16);
      const wobble = contained ? rand(1.5, 3) : rand(2, 5);
      const opacity = rand(0.25, 0.65);
      const scale = rand(0.6, 1.1);
      const wobbleX = contained ? rand(3, 8) : rand(6, 18);
      const delay = rand(0, contained ? 6 : 16);
      const colorStops = [
        'rgba(255,255,255,0.55)',
        'rgba(213,233,165,0.45)',
        'rgba(135,170,113,0.35)',
        'rgba(255,255,255,0.35)',
      ][i % 4];
      const unit = contained ? 'cqh' : 'vh';
      return {
        id: i,
        size,
        x,
        startY,
        endY,
        duration,
        wobble,
        opacity,
        scale,
        wobbleX,
        delay,
        color: colorStops,
        unit,
      };
    };

    const makeScrub = (i) => {
      const size = rand(28, 56);
      const x = rand(0, 100);
      const y = rand(60, 100);
      const duration = rand(3, 7);
      const delay = rand(0, 6);
      return { id: `scrub-${i}`, size, x, y, duration, delay };
    };

    setBubbles(Array.from({ length: count }, (_, i) => makeBubble(i)));
    setScrubs(Array.from({ length: scrubs }, (_, i) => makeScrub(i)));
  }, [count, scrubs]);

  return null;
}

export function __unused_BubblesBackground_markup() {
  return (
    <div className={`bubbles-bg ${className} ${contained ? 'contained' : ''}`} aria-hidden="true">
      {bubbles.map((b) => (
        <div
          key={b.id}
          className="bubble"
          style={{
            '--b-duration': `${b.duration}s`,
            '--b-start-y': `${b.startY}${b.unit}`,
            '--b-end-y': `${b.endY}${b.unit}`,
            '--b-opacity': b.opacity,
            '--b-scale': b.scale,
            '--b-wobble-x': `${b.wobbleX}px`,
            '--b-delay': `${b.delay}s`,
            left: `${b.x}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            background: `linear-gradient(135deg, ${b.color} 0%, rgba(255,255,255,0.15) 40%, rgba(213,233,165,0.35) 100%)`,
          }}
        />
      ))}
      {scrubsArr.map((s) => (
        <div
          key={s.id}
          className="scrub-bubble scrub-move"
          style={{
            '--s-duration': `${s.duration}s`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            left: `${s.x}%`,
            top: `${s.y}%`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
