import './globals.css';
export const metadata = { title: 'Goodwork | Your day, handled.', description: 'A workspace for a local commercial cleaning business.' };
export default function RootLayout({ children }) {
  return <html lang="en"><body>
    <div className="site-demo-strip" role="note">Demo deployment — do not submit real personal or business information. / Despliegue de demostración — no envíe información real personal ni comercial.</div>
    {children}
  </body></html>;
}
