'use client';

import { useState, useTransition } from 'react';
import type { ExceptionDraft } from '@reconcile/domain';
import { ExceptionForm } from './ExceptionForm';

export function DraftException({
  capabilities,
  draftAction,
  saveAction,
}: {
  capabilities: string[];
  draftAction: (text: string) => Promise<ExceptionDraft>;
  saveAction: (input: unknown) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<ExceptionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <div>
      <div className="mt-6 rounded border p-4">
        <h2 className="mb-2 font-medium">Draft from text</h2>
        <p className="mb-2 text-xs text-gray-500">
          Paste a support ticket or contract clause. The AI proposes a draft — nothing is saved until
          you confirm below.
        </p>
        <textarea
          className="w-full rounded border p-2 font-mono text-xs"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Give acct_003 free exports until 2026-12-31 per contract"
        />
        <button
          disabled={pending || !text.trim()}
          className="mt-1 rounded bg-slate-700 px-3 py-1 text-sm text-white disabled:opacity-50"
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                const d = await draftAction(text);
                setDraft(d);
                setFormKey((k) => k + 1);
              } catch (e) {
                setDraft(null);
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          {pending ? 'Drafting…' : 'Draft exception'}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {draft && (
          <p className="mt-2 text-xs text-gray-500">
            Draft by {draft.provider}/{draft.model} — rationale: {draft.rationale}
          </p>
        )}
      </div>
      <ExceptionForm
        key={formKey}
        capabilities={capabilities}
        action={saveAction}
        draft={
          draft
            ? {
                accountId: draft.exception.accountId,
                capability: draft.exception.capability,
                expected: draft.exception.expected,
                expiresAt: draft.exception.expiresAt,
                reason: draft.exception.reason,
              }
            : null
        }
      />
    </div>
  );
}
