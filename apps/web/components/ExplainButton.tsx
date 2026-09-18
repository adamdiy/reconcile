'use client';

import { useState, useTransition } from 'react';
import type { IncidentExplanation } from '@reconcile/domain';

export function ExplainButton({
  fingerprint,
  action,
}: {
  fingerprint: string;
  action: (fp: string) => Promise<IncidentExplanation>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<IncidentExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2">
      <button
        disabled={pending}
        className="rounded border border-slate-400 px-2 py-0.5 text-xs text-slate-700 disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              setResult(await action(fingerprint));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        {pending ? 'Explaining…' : 'Explain (AI, advisory)'}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-2 rounded bg-slate-50 p-3 text-sm">
          <p>{result.summary}</p>
          <ul className="mt-2 list-inside list-disc">
            {result.hypotheses.map((h, i) => (
              <li key={i}>
                {h.text} <span className="text-xs text-gray-500">(confidence: {h.confidence})</span>
                {h.evidenceIds.length > 0 && (
                  <div className="ml-4 font-mono text-xs text-gray-500">
                    evidence: {h.evidenceIds.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">Next step: {result.suggestedNextStep}</p>
          <p className="mt-2 text-xs text-gray-500">
            {result.provider}/{result.model} — generated {result.generatedAt}
          </p>
        </div>
      )}
    </div>
  );
}
