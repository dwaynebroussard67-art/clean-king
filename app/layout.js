import './globals.css';
import BubblesBackground from '../lib/bubbles-bg';
export const metadata = { title: 'Goodwork | Your day, handled.', description: 'A workspace for a local commercial cleaning business.' };
export default function RootLayout({ children }) { return <html lang="en"><body><BubblesBackground count={18} scrubs={4} className="page-bubbles" /><aside className="site-demo-strip" aria-label="Demo notice">Demo deployment — do not submit real personal or business information. / Despliegue de demostración — no envíe información real personal ni comercial.</aside>{children}</body></html>; }
