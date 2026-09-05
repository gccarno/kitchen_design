import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kitchen Design',
  description: 'Design a kitchen with the help of an LLM.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
