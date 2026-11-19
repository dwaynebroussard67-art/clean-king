import Link from 'next/link';
import { redirect } from 'next/navigation';
import { secretKeyValid } from '../../../../lib/server/secret-box.mjs';
import { getAuthorizedAssistantContext } from '../../../../lib/server/owner-assistant-access.js';
import { removeAssistantSecret, saveAssistantSecret, saveAssistantSettings } from './actions';

export const dynamic = 'force-dynamic';

const messages = {
  saved: 'Settings saved. / Configuración guardada.',
  conflict: 'Settings changed in another session. Reload the latest settings before saving. / La configuración cambió en otra sesión. Recarga la versión más reciente antes de guardar.',
  invalid: 'Check the settings and try again. / Revisa la configuración e inténtalo de nuevo.',
  'secret-saved': 'Provider key saved. It will not be shown again. / Clave guardada. No se volverá a mostrar.',
  'secret-removed': 'Provider key removed. / Clave eliminada.',
  'secret-invalid': 'The key could not be saved. Check its length and try again. / No se pudo guardar la clave. Revisa su longitud e inténtalo de nuevo.',
  'secret-unset': 'No provider key was removed. / No se eliminó ninguna clave.',
  'encryption-not-ready': 'Encrypted key storage is not configured. Contact the site administrator. / El almacenamiento cifrado de claves no está configurado. Contacta con la persona administradora del sitio.',
};

export default async function AssistantSettingsPage({ searchParams }) {
  const context = await getAuthorizedAssistantContext();
  if (!context) redirect('/owner/login');
  const params = await searchParams;
  const [{ settings, version }, secrets] = await Promise.all([
    context.store.load(),
    context.store.secretStatus(),
  ]);
  const encryptionReady = secretKeyValid(process.env.ASSISTANT_SECRET_KEY);
  const unreadable = { anthropic: false, custom: false };
  if (encryptionReady) {
    for (const name of ['anthropic', 'custom']) {
      if (!secrets[name].set) continue;
      try {
        await context.store.getSecretPlain(name);
      } catch (error) {
        if (error?.message === 'secret_decrypt_failed') unreadable[name] = true;
      }
    }
  }

  return (
    <div className="public-page">
      <main className="owner-main assistant-owner">
        <Link className="back-link" href="/owner/assistant">← Assistant / Asistente</Link>
        <div className="mini-label">OWNER SETTINGS / CONFIGURACIÓN DEL PROPIETARIO</div>
        <h1>Assistant settings / Configuración del asistente</h1>
        <p className="public-intro">Changes apply to the next request. / Los cambios se aplican a la siguiente solicitud.</p>
        {messages[params?.state] && <p className="inline-notice" role="status">{messages[params.state]}</p>}
        {params?.state === 'conflict' && <p><Link className="btn light" href="/owner/assistant/settings">Reload latest / Recargar la versión más reciente</Link></p>}

        <form action={saveAssistantSettings} className="settings-form">
          <input type="hidden" name="expectedVersion" value={version} />
          <fieldset>
            <legend>Master switch / Interruptor principal</legend>
            <label><input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Enable owner assistant / Activar el asistente del propietario</label>
          </fieldset>

          <fieldset>
            <legend>Persona / Personalidad</legend>
            <label>Assistant name (placeholder) / Nombre del asistente (marcador)<input name="personaName" maxLength={40} defaultValue={settings.persona.name} required /></label>
            <label>Owner name (placeholder) / Nombre del propietario (marcador)<input name="ownerName" maxLength={60} defaultValue={settings.persona.ownerName} required /></label>
            <label>Tone / Tono<select name="tone" defaultValue={settings.persona.tone}><option value="friendly">Friendly / Amable</option><option value="bubbly">Bubbly / Alegre</option><option value="professional">Professional / Profesional</option><option value="concise">Concise / Conciso</option></select></label>
            <label>Emoji / Emojis<select name="emoji" defaultValue={settings.persona.emoji}><option value="none">None / Ninguno</option><option value="light">Light / Moderado</option><option value="lots">A few / Algunos</option></select></label>
            <label>Reply length / Extensión<select name="length" defaultValue={settings.persona.length}><option value="short">Short / Breve</option><option value="normal">Normal</option><option value="detailed">Detailed / Detallada</option></select></label>
          </fieldset>

          <fieldset>
            <legend>Voice / Voz</legend>
            <label><input type="checkbox" name="speakReplies" defaultChecked={settings.voice.speakReplies} /> Speak replies when supported / Leer respuestas en voz alta si está disponible</label>
            <label>Rate / Velocidad<input type="number" name="rate" min="0.5" max="2" step="0.1" defaultValue={settings.voice.rate} /></label>
            <label>Pitch / Tono de voz<input type="number" name="pitch" min="0" max="2" step="0.1" defaultValue={settings.voice.pitch} /></label>
            <label>Voice name / Nombre de voz<input name="voiceName" maxLength={100} defaultValue={settings.voice.voiceName ?? ''} /></label>
          </fieldset>

          <fieldset>
            <legend>What the assistant can see / Lo que puede ver el asistente</legend>
            <p>Counts only. No names, phones or documents are ever sent. / Solo totales. Nunca se envían nombres, teléfonos ni documentos.</p>
            <label><input type="checkbox" name="counts" defaultChecked={settings.capabilities.counts} /> Application and quote counts / Totales de solicitudes y cotizaciones</label>
            <label><input type="checkbox" name="emailHealth" defaultChecked={settings.capabilities.emailHealth} /> Email queue health counts / Totales del estado de correos</label>
          </fieldset>

          <fieldset>
            <legend>Provider / Proveedor</legend>
            <label>Active provider / Proveedor activo<select name="active" defaultValue={settings.provider.active}><option value="anthropic">Anthropic</option><option value="custom">Custom / Personalizado</option></select></label>
            <label>Anthropic model<input name="anthropicModel" maxLength={100} defaultValue={settings.provider.anthropicModel} /></label>
            <label>Custom HTTPS base URL / URL base HTTPS personalizada<input name="customBaseUrl" maxLength={200} type="url" defaultValue={settings.provider.customBaseUrl} /></label>
            <label>Custom model / Modelo personalizado<input name="customModel" maxLength={100} defaultValue={settings.provider.customModel} /></label>
            <label><input type="checkbox" name="fallbackToCustom" defaultChecked={settings.provider.fallbackToCustom} /> Allow custom fallback for temporary provider failures / Permitir alternativa personalizada ante fallas temporales</label>
            <p>Your question and enabled counts are sent to the selected provider. / Tu pregunta y los totales habilitados se envían al proveedor seleccionado.</p>
          </fieldset>

          <fieldset>
            <legend>Limits / Límites</legend>
            <label>Requests per minute / Solicitudes por minuto<input name="perMinute" type="number" min="1" max="10" step="1" defaultValue={settings.limits.perMinute} /></label>
            <label>Requests per month / Solicitudes por mes<input name="perMonth" type="number" min="1" max="1000" step="1" defaultValue={settings.limits.perMonth} /></label>
            <label>Maximum output tokens / Máximo de tokens de salida<input name="maxOutputTokens" type="number" min="50" max="800" step="1" defaultValue={settings.limits.maxOutputTokens} /></label>
            <label>Temperature / Temperatura<input name="temperature" type="number" min="0" max="1" step="0.1" defaultValue={settings.limits.temperature} /></label>
          </fieldset>
          <button className="btn dark" type="submit">Save settings / Guardar configuración</button>
        </form>

        <section className="settings-secrets">
          <h2>Provider keys / Claves de proveedor</h2>
          {!encryptionReady && <p className="form-error" role="alert">Encrypted key storage is not configured; key inputs are disabled. / El almacenamiento cifrado no está configurado; las claves están desactivadas.</p>}
          <p>Rotation procedure: change ASSISTANT_SECRET_KEY, then re-enter both provider keys. / Rotación: cambia ASSISTANT_SECRET_KEY y vuelve a introducir ambas claves.</p>
          {['anthropic', 'custom'].map((name) => (
            <div className="settings-secret" key={name}>
              <h3>{name === 'anthropic' ? 'Anthropic' : 'Custom / Personalizado'}</h3>
              <p>{secrets[name].set ? `Set / Configurada · ••••${secrets[name].last4 ?? ''}` : 'Not set / No configurada'}</p>
              {unreadable[name] && <p className="form-error" role="alert">Stored key cannot be read; please re-enter it. / No se puede leer la clave guardada; vuelve a introducirla.</p>}
              <form action={saveAssistantSecret}>
                <input type="hidden" name="name" value={name} />
                <label>API key / Clave API<input type="password" name="value" minLength={8} maxLength={400} autoComplete="new-password" disabled={!encryptionReady} /></label>
                <button className="btn dark" type="submit" disabled={!encryptionReady}>Save key / Guardar clave</button>
              </form>
              {secrets[name].set && <form action={removeAssistantSecret}>
                <input type="hidden" name="name" value={name} />
                <button className="btn light" type="submit">Remove key / Eliminar clave</button>
              </form>}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
