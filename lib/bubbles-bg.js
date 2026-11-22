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
      <div className="char-bubble-idle">
        <div className="char-bubble-face">
          <div className="char-eye" />
          <div className="char-eye" />
        </div>
        <div className="char-mouth" />
      </div>
      {thinking && (
        <div className="char-bubble-nodes">
          {Array.from({ length: nodeCount }, (_, i) => (
            <div key={i} className="char-bubble-node" />
          ))}
          <div className="char-bubble-thought" />
        </div>
      )}
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
 */
export default function BubblesBackground({ count = 18, scrubs = 4, className = '' }) {
  const [bubbles, setBubbles] = useState([]);
  const [scrubsArr, setScrubs] = useState([]);

  useEffect(() => {
    const rand = (min, max) => Math.random() * (max - min) + min;

    const makeBubble = (i) => {
      const size = rand(24, 120);
      const x = rand(0, 100);
      const startY = rand(100, 110);
      const endY = rand(-120, -20);
      const duration = rand(6, 16);
      const wobble = rand(2, 5);
      const opacity = rand(0.25, 0.65);
      const scale = rand(0.6, 1.1);
      const wobbleX = rand(6, 18);
      const delay = rand(0, 16);
      const colorStops = [
        'rgba(255,255,255,0.55)',
        'rgba(213,233,165,0.45)',
        'rgba(135,170,113,0.35)',
        'rgba(255,255,255,0.35)',
      ][i % 4];
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

  return (
    <div className={`bubbles-bg ${className}`} aria-hidden="true">
      {bubbles.map((b) => (
        <div
          key={b.id}
          className="bubble"
          style={{
            '--b-duration': `${b.duration}s`,
            '--b-wobble': `${b.wobble}s`,
            '--b-start-y': `${b.startY}vh`,
            '--b-end-y': `${b.endY}vh`,
            '--b-opacity': b.opacity,
            '--b-scale': b.scale,
            '--b-wobble-x': `${b.wobbleX}px`,
            left: `${b.x}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            animationDelay: `${b.delay}s`,
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
