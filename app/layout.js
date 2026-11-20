import './globals.css';
import PublicHelper from './public-helper';
export const metadata = { title: 'Goodwork | Your day, handled.', description: 'A workspace for a local commercial cleaning business.' };
export default function RootLayout({ children }) { return <html lang="en"><body>{children}<PublicHelper/></body></html>; }
