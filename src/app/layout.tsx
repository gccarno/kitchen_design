import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Home Design',
  description: 'Design a kitchen or a closet with the help of an LLM.',
  // Installable on a phone: the manifest and icons live in /public.
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Home Design', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#111827',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
