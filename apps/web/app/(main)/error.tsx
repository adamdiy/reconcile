'use client';

export default function GlobalError({ error }: { error: Error }) {
  const forbidden = error.message === 'forbidden';
  return (
    <html>
      <body className="mx-auto max-w-2xl p-6 pt-24 text-gray-900">
        <h1 className="text-xl font-semibold">{forbidden ? '403 — Forbidden' : 'Error'}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {forbidden ? 'Your role does not allow this action.' : error.message}
        </p>
      </body>
    </html>
  );
}
