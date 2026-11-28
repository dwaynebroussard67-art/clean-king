'use client';

import { useEffect, useRef, useState } from 'react';
import { brand } from '../../../lib/brand.mjs';
import { Camera, CheckCircle2, QrCode, XCircle } from 'lucide-react';

export default function ScannerClient() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');

  async function startCamera() {
    setError('');
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch {
      setError('Camera access was denied or is unavailable on this device. You can enter a code manually below.');
      setScanning(false);
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }

  useEffect(() => {
    if (!scanning) return;
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
      return;
    }

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    let active = true;

    const tick = async () => {
      if (!active || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0 && codes[0].rawValue) {
          setResult(codes[0].rawValue);
          stopCamera();
          return;
        }
      } catch {
        // Ignore transient frame errors
      }
      if (active) requestAnimationFrame(tick);
    };

    const id = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(id);
    };
  }, [scanning]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    setResult(manualCode.trim());
    setManualCode('');
  }

  return (
    <div style={{ maxWidth: '520px', margin: '2rem auto', padding: '1.5rem', background: '#fff', borderRadius: '16px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
        <QrCode size={24} />
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>{brand.name} QR Scanner</h1>
      </div>
      <p style={{ color: '#4b5563', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
        Scan a site check-in QR code, equipment tag, or referral invite.
      </p>

      {error && (
        <div role="alert" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0.75rem', background: '#fef2f2', color: '#991b1b', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div role="status" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0.75rem', background: '#ecfdf5', color: '#065f46', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.95rem' }}>
          <CheckCircle2 size={18} />
          <div>
            <strong>Scanned:</strong> <span>{result}</span>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '1rem' }}>
        {!scanning ? (
          <button type="button" className="btn dark" onClick={startCamera} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Camera size={18} />
            Start Camera Scanner
          </button>
        ) : (
          <button type="button" className="btn light" onClick={stopCamera}>
            Stop Camera
          </button>
        )}
      </div>

      {scanning && (
        <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #d1d5db', marginBottom: '1rem', background: '#000' }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block' }} />
        </div>
      )}

      <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
        <input
          type="text"
          value={manualCode}
          onChange={e => setManualCode(e.target.value)}
          placeholder="Or enter QR / referral code manually..."
          style={{ flex: 1, padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #d1d5db' }}
        />
        <button type="submit" className="btn light">Submit</button>
      </form>
    </div>
  );
}
