'use client';
import { useState, useEffect, useRef } from 'react';
import { Play, Pause, CheckCircle2, X, LockKeyhole } from 'lucide-react';

const LESSON_VIDEOS = {
  0: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  1: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  2: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
};

const LESSON_TITLES = {
  en: ['How we clean here', 'Restrooms and trash', 'Chemical safety basics'],
  es: ['Cómo limpiamos aquí', 'Baños y basura', 'Seguridad química básica'],
};

const LESSON_DESCRIPTIONS = {
  en: [
    'Review the approved site instructions and ask your supervisor if anything is unclear. Wear the required protective equipment and leave areas safe for other people.',
    'Follow the approved sequence and products for each surface. Avoid cross-contamination between areas. Handle waste according to site instructions; report hazardous objects rather than handling them without authorization.',
    'Read the label and safety data sheet before using a product. Follow the manufacturer and site instructions. Never mix cleaning chemicals. If there is a spill or exposure, move away and report it according to site procedures.',
  ],
  es: [
    'Revisa las instrucciones aprobadas del lugar y pregunta a tu supervisor si algo no está claro. Usa el equipo de protección indicado y deja las áreas seguras para otras personas.',
    'Sigue la secuencia y los productos aprobados para cada superficie. Evita la contaminación entre áreas. Manipula los residuos según las instrucciones del lugar; informa sobre objetos peligrosos en vez de recogerlos sin autorización.',
    'Lee la etiqueta y la hoja de datos de seguridad antes de usar un producto. Sigue las indicaciones del fabricante y del lugar. Nunca mezcles productos químicos. Si hay un derrame o una exposición, aléjate e informa al supervisor según el procedimiento del lugar.',
  ],
};

export default function TrainingPlayer({ lessonIndex, lang, onComplete, onClose, disabled }) {
  const [playing, setPlaying] = useState(false);
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const videoRef = useRef(null);
  const timerRef = useRef(null);

  const title = LESSON_TITLES[lang][lessonIndex];
  const description = LESSON_DESCRIPTIONS[lang][lessonIndex];
  const videoSrc = LESSON_VIDEOS[lessonIndex];

  // Auto-complete after 30 seconds of "watching" (simulates a short training clip)
  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setPlayedSeconds((s) => {
        const next = s + 1;
        if (next >= 30 && !completed) {
          setCompleted(true);
          setPlaying(false);
          if (timerRef.current) clearInterval(timerRef.current);
          if (onComplete) onComplete();
        }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing]);

  const togglePlay = () => {
    if (disabled) return;
    setPlaying((p) => !p);
  };

  const handleComplete = () => {
    setCompleted(true);
    setPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (onComplete) onComplete();
  };

  const progress = Math.min(playedSeconds / 30, 1);

  return (
    <div className="training-video-player">
      <div className="video-container">
        <video
          ref={videoRef}
          src={videoSrc}
          onClick={togglePlay}
          className="lesson-video"
          style={{--play-state: playing ? 'playing' : 'paused'}}
        >
          Your browser does not support video.
        </video>
        <div className={`video-overlay ${playing ? 'playing' : ''}`}>
          <button className="video-play-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={32} /> : <Play size={32} />}
          </button>
        </div>
        <div className="video-controls">
          <div className="video-progress">
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
            <span className="time-display">{Math.floor(playedSeconds)}s / 30s</span>
          </div>
          {completed ? (
            <div className="video-complete">
              <CheckCircle2 size={16} />
              <span>{t.lang === 'en' ? 'Completed' : 'Completado'}</span>
            </div>
          ) : (
            <button
              className="btn dark small complete-btn"
              onClick={handleComplete}
              disabled={disabled || playedSeconds < 5}
            >
              <CheckCircle2 size={14} />
              {lang === 'en' ? 'Mark as viewed' : 'Marcar como vista'}
            </button>
          )}
        </div>
      </div>
      <div className="lesson-meta">
        <h2>{title}</h2>
        {showDescription ? (
          <div className="lesson-desc">{description}</div>
        ) : (
          <button className="lesson-desc-toggle" onClick={() => setShowDescription(true)}>
            {lang === 'en' ? 'Show lesson notes' : 'Ver notas de la lección'}
          </button>
        )}
      </div>
      <p className="lesson-disclaimer">
        {lang === 'en'
          ? 'This is a sample training video. In production, only owner-approved content is used. Viewing does not verify training.'
          : 'Este es un video de entrenamiento de ejemplo. En producción, solo se usa contenido aprobado por el dueño. Verlo no verifica la capacitación.'}
      </p>
    </div>
  );
}
