'use client';

import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

function Field({ path, label, value, change, invalid, hint, type = 'text', options, ...attrs }) {
  const id = `as-${path}`;
  const props = {
    id, name: path, 'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? `${id}-error` : undefined, ...attrs,
  };
  const error = invalid && <small id={`${id}-error`} className="as-field-error">{hint}</small>;
  if (type === 'checkbox') return (
    <div className="as-field"><label className="as-check" htmlFor={id}>
      <input {...props} type="checkbox" checked={value} onChange={e => change(e.target.checked)} />{label}
    </label>{error}</div>
  );
  return (
    <div className="as-field">
      <label htmlFor={id}>{label}</label>
      {options ? <select {...props} value={value ?? ''} onChange={e => change(e.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select> : <input {...props} type={type} value={value} onChange={e => {
        const el = e.target;
        change(type === 'number' && el.value !== '' ? el.valueAsNumber : el.value);
      }} />}
      {error}
    </div>
  );
}

function SecretControl({ name, label, status, disabled, submit, t }) {
  const input = useRef(null);
  const ending = typeof status.last4 === 'string' && status.last4.length === 4 ? status.last4 : '';
  function send(clear) {
    const value = input.current.value;
    input.current.value = '';
    submit(clear ? { name, clear: true } : { name, value });
  }
  return (
    <form method="post" className="as-key" onSubmit={e => { e.preventDefault(); send(false); }}>
      <label htmlFor={`as-key-${name}`}>{label} · {t('API key', 'Clave API')}</label>
      <small>{status.set ? `${t('Saved here', 'Guardada aquí')} · ••••${ending}` : t('No saved key', 'Sin clave guardada')}</small>
      <input id={`as-key-${name}`} type="password" ref={input} autoComplete="new-password" autoCapitalize="none"
        spellCheck={false} disabled={disabled} minLength={8} maxLength={400} required />
      <div className="as-actions">
        <button disabled={disabled}>{t('Save key', 'Guardar clave')}</button>
        <button type="button" disabled={disabled || !status.set} onClick={() => send(true)}>{t('Remove key', 'Eliminar clave')}</button>
      </div>
    </form>
  );
}

function testFailure(code, t) {
  const messages = {
    config: ['Check the saved model, URL and key.', 'Revisa el modelo, la URL y la clave guardados.'],
    auth: ['The provider did not accept these credentials.', 'El proveedor no aceptó estas credenciales.'],
    rate_limit: ['The provider reached its request limit. Try later.', 'El proveedor alcanzó su límite de solicitudes. Inténtalo más tarde.'],
    timeout: ['The provider took too long to reply.', 'El proveedor tardó demasiado en responder.'],
    upstream: ['The provider is unavailable. Try again later.', 'El proveedor no está disponible. Inténtalo más tarde.'],
    bad_response: ['The provider did not return a usable text reply.', 'El proveedor no devolvió una respuesta de texto válida.'],
    blocked_url: ['This provider URL is not allowed.', 'No se permite esta URL del proveedor.'],
  };
  return t(...(Object.hasOwn(messages, code) ? messages[code] : messages.upstream));
}

export default function SettingsPanel({ workspace, updateWorkspace, t, request, problemView, voices, speechReady, preview }) {
  const { settings, version, secrets, encryptionReady } = workspace;
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [invalid, setInvalid] = useState([]);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState(null);
  const [area, setArea] = useState('preferences');
  const lock = useRef(false), focusPath = useRef(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const custom = t('Custom', 'Personalizado');

  useEffect(() => {
    if (busy || !focusPath.current) return;
    document.getElementById(`as-${focusPath.current}`)?.focus();
    focusPath.current = null;
  }, [busy, invalid]);

  function change(path, value) {
    const [group, key] = path.split('.');
    setDraft(old => key ? { ...old, [group]: { ...old[group], [key]: value } } : { ...old, [group]: value });
    setInvalid(old => old.filter(p => p !== path));
    setNotice(null);
  }

  function field(path, label, options = {}) {
    const [group, key] = path.split('.');
    return <Field path={path} value={key ? draft[group][key] : draft[group]} label={label}
      hint={t('Choose a valid value.', 'Elige un valor válido.')} invalid={invalid.includes(path)}
      change={v => change(path, path === 'voice.voiceName' && v === '' ? null : v)} {...options} />;
  }

  function numeric(path, label, min, max, integer = false) {
    return field(path, `${label} (${min}–${max})`, {
      type: 'number', min, max, step: integer ? 1 : 'any', required: true,
      hint: integer ? t(`Enter a whole number from ${min} to ${max}.`, `Escribe un entero de ${min} a ${max}.`)
        : t(`Enter a number from ${min} to ${max}.`, `Escribe un número de ${min} a ${max}.`),
    });
  }

  async function operation(section, action) {
    if (lock.current) return;
    lock.current = true;
    setArea(section); setBusy(true); setIssue(''); setNotice(null); setInvalid([]);
    try { await action(); } catch { setIssue('provider_failed'); }
    finally { lock.current = false; setBusy(false); }
  }

  function save(e) {
    e.preventDefault();
    if (!dirty || conflict) return;
    operation('preferences', async () => {
      const { data, error, paths } = await request('PUT', '/settings', { settings: draft, expectedVersion: version });
      if (error) {
        if (error === 'conflict') setConflict(true);
        if (error === 'invalid') {
          const fields = (paths || []).filter(p => typeof p === 'string');
          focusPath.current = fields[0];
          setInvalid(fields);
        }
        setIssue(error);
        return;
      }
      if (!data?.settings || !Number.isSafeInteger(data.version)) throw new Error();
      setDraft(data.settings);
      updateWorkspace({ settings: data.settings, version: data.version });
      setNotice({ kind: 'saved' });
    });
  }

  function secret(payload) {
    operation('connection', async () => {
      const { data, error } = await request('POST', '/settings/secret', payload);
      if (error) {
        if (error === 'encryption_not_ready') updateWorkspace({ encryptionReady: false });
        setIssue(error);
        return;
      }
      if (!data?.secrets?.anthropic || !data.secrets.custom) throw new Error();
      updateWorkspace({ secrets: data.secrets });
      setNotice({ kind: payload.clear ? 'removed' : 'key' });
    });
  }

  function testConnection() {
    operation('connection', async () => {
      const { data, error } = await request('POST', '/settings/test', {});
      if (error) { setIssue(error); return; }
      if (data?.ok === true && ['anthropic', 'custom'].includes(data.provider) &&
          typeof data.model === 'string' && Number.isFinite(data.latencyMs)) {
        setNotice({ kind: 'tested', provider: data.provider, model: data.model, ms: data.latencyMs });
      } else setNotice({ kind: 'failed', code: data?.code });
    });
  }

  const nameHint = max => t(`Use 1–${max} letters, digits, spaces, apostrophes, periods or hyphens.`,
    `Usa de 1 a ${max} letras, dígitos, espacios, apóstrofos, puntos o guiones.`);
  const modelHint = t('Use up to 100 letters, digits or . _ : / - for the model ID.',
    'Usa hasta 100 letras, dígitos o . _ : / - para el identificador del modelo.');
  const voiceNames = [...new Set([...voices, draft.voice.voiceName].filter(Boolean))];
  const announcements = {
    saved: t('Settings saved.', 'Configuración guardada.'), key: t('Key saved.', 'Clave guardada.'),
    removed: t('Saved key removed.', 'Clave guardada eliminada.'),
    tested: `${t('Connected', 'Conexión correcta')}: ${notice?.provider === 'anthropic' ? 'Anthropic' : custom} · ${notice?.model} · ${notice?.ms} ms`,
    failed: testFailure(notice?.code, t),
  };
  function feedback(section) {
    return <>
      {area === section && problemView(issue)}
      <p role="status" className="as-status" aria-live="polite">
        {area === section && (busy ? t('Working…', 'Procesando…') : notice ? announcements[notice.kind] : '')}
      </p>
    </>;
  }

  return (
    <section id="as-settings" tabIndex={-1} aria-labelledby="as-settings-title" className="as-card as-settings">
      <p className="as-kicker">{t('OWNER CONTROLS', 'CONTROLES DEL DUEÑO')}</p>
      <h2 id="as-settings-title"><SlidersHorizontal size={21} aria-hidden="true" />{t('Assistant settings', 'Configuración del asistente')}</h2>
      <form method="post" onSubmit={save}>
        <fieldset className="as-group" disabled={busy}>
          <legend>{t('Master switch', 'Activación')}</legend>
          {field('enabled', t('Enable the owner assistant', 'Activar el asistente del dueño'), { type: 'checkbox' })}
        </fieldset>
        <fieldset className="as-group" disabled={busy}>
          <legend>{t('Persona', 'Personalidad')}</legend>
          <p>{t('Use fictional display names. Both names are included in provider instructions.',
            'Usa nombres ficticios. Los dos nombres se incluyen en las instrucciones para el proveedor.')}</p>
          <div className="as-grid">
            {field('persona.name', t('Assistant name', 'Nombre del asistente'), { maxLength: 40, required: true, hint: nameHint(40) })}
            {field('persona.ownerName', t('Owner display name', 'Nombre del dueño'), { maxLength: 60, required: true, hint: nameHint(60) })}
            {field('persona.tone', t('Tone', 'Tono'), { options: [
              ['bubbly', t('Enthusiastic', 'Entusiasta')], ['friendly', t('Friendly', 'Amable')],
              ['professional', t('Professional', 'Profesional')], ['concise', t('Concise', 'Conciso')],
            ] })}
            {field('persona.emoji', t('Emoji use', 'Uso de emojis'), { options: [
              ['none', t('None', 'Ninguno')], ['light', t('At most one', 'Como máximo uno')], ['lots', t('A few', 'Algunos')],
            ] })}
            {field('persona.length', t('Reply length', 'Extensión de respuesta'), { options: [
              ['short', t('Short', 'Corta')], ['normal', 'Normal'], ['detailed', t('Detailed', 'Detallada')],
            ] })}
          </div>
        </fieldset>
        <fieldset className="as-group" disabled={busy}>
          <legend>{t('Voice', 'Voz')}</legend>
          {field('voice.speakReplies', t('Speak replies aloud', 'Leer las respuestas en voz alta'), { type: 'checkbox' })}
          <div className="as-grid">
            {numeric('voice.rate', t('Speaking rate', 'Velocidad'), 0.5, 2)}
            {numeric('voice.pitch', t('Pitch', 'Tono de voz'), 0, 2)}
            {field('voice.voiceName', t('Device voice', 'Voz del dispositivo'), { options: [
              ['', t('Device default', 'Predeterminada del dispositivo')], ...voiceNames.map(n => [n, n]),
            ] })}
          </div>
          <button type="button" disabled={!speechReady} onClick={() => preview(draft.voice)}>{t('Preview voice', 'Probar voz')}</button>
          <p>{t('Some browser voices use an online speech service. Leave playback off if you prefer.',
            'Algunas voces del navegador utilizan un servicio en línea. Si prefieres, deja la lectura desactivada.')}</p>
        </fieldset>
        <fieldset className="as-group" disabled={busy}>
          <legend>{t('What it can see', 'Qué puede ver')}</legend>
          <p>{t('From inbox records: Counts only. No names, phones or documents are ever sent.', 'Solo totales. No se envían nombres, teléfonos ni documentos de los registros.')}</p>
          {field('capabilities.counts', t('New applications and quote requests', 'Solicitudes de empleo y cotización nuevas'), { type: 'checkbox' })}
          {field('capabilities.emailHealth', t('Queued and failed application emails', 'Correos de solicitudes en cola y fallidos'), { type: 'checkbox' })}
          <p className="as-note">{t('Your question and the counts above are sent to the provider you choose.',
            'Tu pregunta y los totales anteriores se envían al proveedor que elijas.')}</p>
        </fieldset>
        <fieldset className="as-group" disabled={busy}>
          <legend>{t('Provider', 'Proveedor')}</legend>
          <div className="as-actions" role="radiogroup" aria-label={t('Active provider', 'Proveedor activo')}>
            {['anthropic', 'custom'].map((name, i) => <label className="as-check" key={name}>
              <input type="radio" name="provider.active" id={!i ? 'as-provider.active' : undefined} value={name}
                checked={draft.provider.active === name} onChange={() => change('provider.active', name)}
                aria-invalid={invalid.includes('provider.active') || undefined}
                aria-describedby={invalid.includes('provider.active') ? 'as-provider-error' : undefined} />{i ? custom : 'Anthropic'}
            </label>)}
          </div>
          {invalid.includes('provider.active') && <small id="as-provider-error" className="as-field-error">{t('Choose a provider.', 'Elige un proveedor.')}</small>}
          {field('provider.anthropicModel', t('Anthropic model', 'Modelo de Anthropic'), { maxLength: 100, required: true, hint: modelHint })}
          <div className="as-grid">
            {field('provider.customBaseUrl', t('Custom base URL', 'URL base personalizada'), { type: 'url', maxLength: 200,
              hint: t('Use an allowed HTTPS URL without credentials, query or fragment.', 'Usa una URL HTTPS permitida sin credenciales, consulta ni fragmento.') })}
            {field('provider.customModel', t('Custom model', 'Modelo personalizado'), { maxLength: 100, hint: modelHint })}
          </div>
          {field('provider.fallbackToCustom', t('Try Custom if Anthropic is temporarily unavailable', 'Probar el proveedor personalizado si Anthropic no está disponible'), { type: 'checkbox' })}
          <p className="as-note">{t('Fallback may share the same question, history and counts with Custom. Changing provider or count groups here clears this chat.',
            'El respaldo puede compartir la pregunta, el historial y los totales con el proveedor personalizado. Cambiar de proveedor o de grupos de totales aquí borra este chat.')}</p>
        </fieldset>
        <fieldset className="as-group" disabled={busy}>
          <legend>{t('Limits', 'Límites')}</legend>
          <div className="as-grid">
            {numeric('limits.perMinute', t('Runs per minute', 'Solicitudes por minuto'), 1, 10, true)}
            {numeric('limits.perMonth', t('Runs per UTC month', 'Solicitudes por mes UTC'), 1, 1000, true)}
            {numeric('limits.maxOutputTokens', t('Maximum output tokens', 'Máximo de tokens de respuesta'), 50, 800, true)}
            {numeric('limits.temperature', t('Temperature', 'Temperatura'), 0, 1)}
          </div>
        </fieldset>
        <div className="as-actions">
          <button className="as-primary" disabled={busy || !dirty || conflict}>{t('Save settings', 'Guardar configuración')}</button>
          {dirty && <span className="as-pill">{t('Unsaved changes', 'Cambios sin guardar')}</span>}
        </div>
      </form>
      {conflict && <div className="as-note">
        <p>{t('Reloading discards unsaved edits and clears this chat.', 'Al recargar se descartan los cambios sin guardar y se borra este chat.')}</p>
        <button type="button" onClick={() => window.location.reload()}>{t('Reload latest', 'Cargar versión más reciente')}</button>
      </div>}
      {feedback('preferences')}
      <fieldset className="as-group" disabled={busy}>
        <legend>{t('Saved connection', 'Conexión guardada')}</legend>
        <p>{t('Key changes take effect immediately. An Anthropic server key, if configured, can still be used after removing a saved key.',
          'Los cambios de clave son inmediatos. Si hay una clave de Anthropic en el servidor, se puede usar al eliminar la clave guardada.')}</p>
        {!encryptionReady && <p className="as-note">{t('Key editing is disabled until the administrator configures encryption.',
          'La edición de claves está desactivada hasta que el administrador configure el cifrado.')}</p>}
        <div className="as-grid">{['anthropic', 'custom'].map(name => <SecretControl key={name} name={name}
          label={name === 'anthropic' ? 'Anthropic' : custom} status={secrets[name]} disabled={!encryptionReady || busy} submit={secret} t={t} />)}</div>
        <p>{t('Save preferences first. Each connection test uses one workspace run.', 'Guarda primero las preferencias. Cada prueba consume una solicitud del espacio.')}</p>
        <button type="button" disabled={busy || dirty || conflict} onClick={testConnection}>{t('Test connection', 'Probar conexión')}</button>
      </fieldset>
      {feedback('connection')}
    </section>
  );
}
