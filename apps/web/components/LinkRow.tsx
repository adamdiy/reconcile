'use client';

import { useState, useTransition } from 'react';
import { deleteLink, upsertLinkAction } from '../lib/actions';

export function LinkRow({
  accountId,
  suggestions = [],
  linked = false,
}: {
  accountId: string;
  suggestions?: string[];
  linked?: boolean;
}) {
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState('');

  if (linked) {
    return (
      <button
        disabled={pending}
        className="text-xs text-red-600"
        onClick={() => start(() => deleteLink(accountId))}
      >
        Remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {suggestions.map((c) => (
        <button
          key={c}
          disabled={pending}
          className="rounded border px-2 py-0.5 text-xs"
          onClick={() => start(() => upsertLinkAction(accountId, c))}
        >
          Confirm {c}
        </button>
      ))}
      <input
        className="w-32 rounded border px-1 py-0.5 font-mono text-xs"
        placeholder="cus_..."
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
      />
      <button
        disabled={pending || !custom}
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
        onClick={() => start(() => upsertLinkAction(accountId, custom))}
      >
        Link
      </button>
    </span>
  );
}
