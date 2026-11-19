import { redirect } from 'next/navigation';
import PublicHeader from '../../public/header';
import { requestLink } from '../actions';
import { signedInDestination } from '../../../lib/server/auth-destination.js';
import { ownerLoginEnabled, sessionClient } from '../../../lib/server/supabase.js';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }) {
  const params = await searchParams;
  const state = params?.state;
  const enabled = ownerLoginEnabled();
  if (enabled) {
    const client = await sessionClient();
    if (client) {
      const { data, error } = await client.auth.getUser();
      if (!error && data?.user?.id) redirect(await signedInDestination(client, data.user.id));
    }
  }

  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-main">
        <div className="public-card">
          <div className="mini-label">OWNER ACCESS / ACCESO DEL PROPIETARIO</div>
          <h1>Welcome back. / Te damos la bienvenida.</h1>
          <p className="public-intro">Owner access is restricted to explicitly approved accounts. / El acceso del propietario está limitado a cuentas aprobadas explícitamente.</p>
          {!enabled ? (
            <div className="inline-notice">Owner sign-in is not configured. Passkeys and approved-device controls are required before launch. / El inicio de sesión del propietario no está configurado. Se requieren llaves de acceso y controles de dispositivos aprobados antes del lanzamiento.</div>
          ) : (
            <>
              <div className="inline-notice">Development access only: email links do not yet provide passkey or approved-device protection. / Solo para desarrollo: los enlaces por correo aún no ofrecen protección con llaves de acceso ni dispositivos aprobados.</div>
              {state === 'sent' ? (
                <p className="intake-success" role="status">If the account is eligible, a sign-in link has been sent. Open it on this device. / Si la cuenta es elegible, se envió un enlace de acceso. Ábrelo en este dispositivo.</p>
              ) : (
                <form className="public-form" action={requestLink}>
                  <label>Email address / Correo electrónico<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
                  {state === 'invalid' && <p className="form-error">Could not sign in. Please try again. / No se pudo iniciar sesión. Inténtalo de nuevo.</p>}
                  <button className="btn dark public-submit">Send sign-in link / Enviar enlace de acceso</button>
                </form>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
