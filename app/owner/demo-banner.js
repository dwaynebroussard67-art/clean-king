import 'server-only';
import { demoModeEnabled } from '../../lib/auth-config.mjs';
import PublicHeader from '../public/header';
import './assistant/settings.css';

export default function DemoBanner({ enabled = demoModeEnabled(process.env) }) {
  if (!enabled) return null;
  return (
    <aside className="as-banner" aria-label="Demo / Demostración">
      <strong lang="en">DEMO · synthetic data only — do not enter real applicant, customer, student or patient information</strong>
      <span lang="es">DEMO · solo datos sintéticos — no introduzcas información real de solicitantes, clientes, estudiantes ni pacientes</span>
    </aside>
  );
}

// Both owner-inbox render paths use this header. No environment values become client props.
export function OwnerHeader() {
  return <><PublicHeader /><DemoBanner /></>;
}
