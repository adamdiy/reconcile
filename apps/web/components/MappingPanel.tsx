'use client';

import { useState, useTransition } from 'react';
import { confirmMapping, suggestMapping } from '../lib/actions';
import type { MappingSuggestion } from '@reconcile/ai';

export function MappingPanel() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ suggestions: MappingSuggestion[]; provider: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4">
      <button
        className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setResult(await suggestMapping());
              setError(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        {pending ? 'Suggesting…' : 'Suggest mapping'}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-4">
          <p className="text-sm text-gray-600">
            provider: <strong>{result.provider}</strong>
            {result.provider === 'stub' && ' (fixture-backed stub — no API key configured)'}
          </p>
          <ul className="mt-2 space-y-2">
            {result.suggestions.map((s) => (
              <li key={s.priceId} className="rounded border p-3 text-sm">
                <div className="font-mono">{s.priceId}</div>
                <div>capabilities: {s.capabilities.join(', ')}</div>
                <div className="text-gray-500">{s.rationale}</div>
                <form action={confirmMapping} className="mt-2">
                  <input type="hidden" name="priceId" value={s.priceId} />
                  <input type="hidden" name="capabilities" value={s.capabilities.join(',')} />
                  <button className="rounded border px-2 py-0.5 text-xs">Confirm into draft</button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
