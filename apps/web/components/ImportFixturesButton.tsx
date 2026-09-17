'use client';

import { useTransition } from 'react';
import { importFixtures } from '../lib/actions';

export function ImportFixturesButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => importFixtures())}
      disabled={pending}
      title="Simulated collector — reload fixture sources"
      className="rounded border border-gray-400 px-3 py-1 text-sm text-gray-700 disabled:opacity-50"
    >
      {pending ? 'Importing…' : 'Import fixtures'}
    </button>
  );
}
