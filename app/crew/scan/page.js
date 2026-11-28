import { defaultBrand } from '../../../lib/brand.mjs';
import ScannerClient from './scanner-client';

export const metadata = {
  title: `QR Scanner | ${defaultBrand.name}`,
};

export default function CrewScanPage() {
  return (
    <main style={{ padding: '1.5rem' }}>
      <ScannerClient />
    </main>
  );
}
