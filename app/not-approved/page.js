import PublicHeader from '../public/header';
import { signOut } from '../owner/actions';

export const dynamic = 'force-dynamic';

export default function NotApprovedPage() {
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-main">
        <div className="public-card">
          <div className="mini-label">ACCOUNT ACCESS / ACCESO A LA CUENTA</div>
          <h1>Access is not approved. / El acceso no está aprobado.</h1>
          <p className="public-intro">This account is not an approved owner account or an active employee account. Contact the business owner if you believe this is an error. / Esta cuenta no está aprobada como cuenta del propietario ni como cuenta activa de empleado. Contacta al propietario del negocio si crees que esto es un error.</p>
          <form action={signOut}>
            <button className="btn light" type="submit">Sign out / Cerrar sesión</button>
          </form>
        </div>
      </main>
    </div>
  );
}
