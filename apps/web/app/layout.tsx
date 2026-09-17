import Link from 'next/link';
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Reconcile (hackathon demo)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-6xl p-6 text-gray-900">
        <header className="mb-6 flex items-center justify-between border-b pb-3">
          <Link href="/" className="text-lg font-semibold">
            Reconcile
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/">Overview</Link>
            <Link href="/incidents">Incidents</Link>
            <Link href="/setup/mapping">Mapping setup</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
