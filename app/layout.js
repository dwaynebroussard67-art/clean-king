import './globals.css';
import { defaultBrand } from '../lib/brand.mjs';
export const metadata = { title: `${defaultBrand.name} | ${defaultBrand.tagline}`, description: `${defaultBrand.name} — ${defaultBrand.tagline}.` };
export default function RootLayout({ children }) { return <html lang="en" data-brand={defaultBrand.id} style={defaultBrand.palette}><body>{children}</body></html>; }
