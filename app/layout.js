import './globals.css';
import './site.css';
import { brand } from '../lib/brand.mjs';

export const metadata = {
  title: { default: `${brand.name} | ${brand.motto}`, template: `%s | ${brand.name}` },
  description: `Meet ${brand.owner} and ${brand.name}. ${brand.motto}. Explore janitorial service information, quote planning and crew applications.`,
  applicationName: brand.name,
  openGraph: { type: 'website', siteName: brand.name, title: brand.name, description: brand.motto },
  icons: { icon: brand.mark },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
