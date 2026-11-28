import Dashboard from '../ui';

export const metadata = { title: 'Example owner workspace', robots: { index: false } };

// The original, browser-memory walkthrough. Never an authenticated owner session.
export default function Workspace() { return <Dashboard />; }
