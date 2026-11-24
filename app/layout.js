import './globals.css';
import BubblesBackground from '../lib/bubbles-bg';
import BubblesWidget from './public/bubbles-widget';
export const metadata = { title: 'Clean King | Your day, handled.', description: 'A workspace for a local commercial cleaning business.' };
export default function RootLayout({ children }) { return <html lang="en"><body><BubblesBackground count={18} scrubs={4} className="page-bubbles" />{children}<BubblesWidget /></body></html>; }
