import '../globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Reconcile report' };

export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-3xl p-8 text-sm text-gray-900 print:max-w-none print:p-0">
        {children}
      </body>
    </html>
  );
}
