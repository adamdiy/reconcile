'use client';

import { useState, useTransition } from 'react';

export function TestProviderButton({
  action,
}: {
  action: () => Promise<{ ok: boolean; detail: string }>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  return (
    <div className="mt-3">
      <button
        disabled={pending}
        className="rounded bg-slate-700 px-3 py-1 text-sm text-white disabled:opacity-50"
        onClick={() => start(async () => setResult(await action()))}
      >
        {pending ? 'Testing…' : 'Test provider'}
      </button>
      {result && (
        <p className={`mt-2 text-sm ${result.ok ? 'text-green-700' : 'text-red-600'}`}>
          {result.detail}
        </p>
      )}
    </div>
  );
}
