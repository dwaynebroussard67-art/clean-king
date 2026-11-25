import ScannerClient from './scanner-client';

export const metadata = {
  title: 'QR Scanner | Clean King',
};

export default function CrewScanPage() {
  return (
    <main style={{ padding: '1.5rem' }}>
      <ScannerClient />
    </main>
  );
}
