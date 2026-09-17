'use client';

import { useTransition } from 'react';
import { recheck } from '../lib/actions';

export function RecheckButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => recheck())}
      disabled={pending}
      className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
    >
      {pending ? 'Rechecking…' : 'Recheck'}
    </button>
  );
}
