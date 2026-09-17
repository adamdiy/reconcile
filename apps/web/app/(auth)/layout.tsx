import '../globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Reconcile — sign in' };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-sm p-6 pt-24 text-gray-900">{children}</body>
    </html>
  );
}
