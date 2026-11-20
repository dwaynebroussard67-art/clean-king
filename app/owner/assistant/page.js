import Link from 'next/link';
import { redirect } from 'next/navigation';
import PublicHeader from '../../public/header';
import { getAuthorizedAssistantContext } from '../../../lib/server/owner-assistant-access.js';
import OwnerChat from './owner-chat';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const context = await getAuthorizedAssistantContext();
  if (!context) redirect('/owner/login');
  const { settings } = await context.store.load();
  const enabled = settings.enabled && process.env.OWNER_ASSISTANT_ENABLED === 'true';

  return (
    <div className="public-page">
      <PublicHeader />
      <main className="owner-main assistant-owner">
        <Link className="back-link" href="/owner">← Owner inbox / Bandeja del propietario</Link>
        <div className="mini-label">OWNER ASSISTANT / ASISTENTE DEL PROPIETARIO</div>
        <h1>Read-only help / Ayuda de solo lectura</h1>
        <p className="public-intro">Answers use only approved counts. No actions are available. / Las respuestas solo usan totales aprobados. No se pueden realizar acciones.</p>
        <p><Link className="btn light" href="/owner/assistant/settings">Settings / Configuración</Link></p>
        <OwnerChat
          enabled={enabled}
          personaName={settings.persona.name}
          ownerName={settings.persona.ownerName}
          speakReplies={settings.voice.speakReplies}
          rate={settings.voice.rate}
          pitch={settings.voice.pitch}
          voiceName={settings.voice.voiceName}
        />
      </main>
    </div>
  );
}
