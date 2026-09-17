'use client';

import { useState, useTransition } from 'react';

export function ExceptionForm({
  capabilities,
  action,
  draft,
}: {
  capabilities: string[];
  action: (input: unknown) => Promise<void>;
  draft?: {
    accountId: string;
    capability: string;
    expected: boolean;
    expiresAt: string;
    reason: string;
  } | null;
}) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    id: draft ? `ex_draft_${Date.now()}` : `ex_${Date.now()}`,
    accountId: draft?.accountId ?? '',
    capability: draft?.capability ?? capabilities[0] ?? '',
    expected: String(draft?.expected ?? true),
    reason: draft?.reason ?? '',
    owner: '',
    expiresAt: draft ? draft.expiresAt.slice(0, 10) : '',
  });
  const input = 'rounded border px-1 py-0.5 text-xs font-mono';
  return (
    <div className="mt-6 rounded border p-4">
      <h2 className="mb-2 font-medium">Add exception</h2>
      {draft && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Drafted from text — review and click “Add exception” to save. Advisory: AI output does not
          change results or authorize access.
        </p>
      )}
      <div className="grid grid-cols-4 gap-2">
        <input className={input} placeholder="accountId" value={f.accountId}
          onChange={(e) => setF({ ...f, accountId: e.target.value })} />
        <select className={input} value={f.capability}
          onChange={(e) => setF({ ...f, capability: e.target.value })}>
          {capabilities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={input} value={f.expected}
          onChange={(e) => setF({ ...f, expected: e.target.value })}>
          <option value="true">expected true</option>
          <option value="false">expected false</option>
        </select>
        <input className={input} placeholder="expiresAt (ISO)" value={f.expiresAt}
          onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
        <input className={input} placeholder="reason" value={f.reason}
          onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <input className={input} placeholder="owner" value={f.owner}
          onChange={(e) => setF({ ...f, owner: e.target.value })} />
      </div>
      <button
        disabled={pending || !f.accountId || !f.expiresAt}
        className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        onClick={() =>
          start(async () => {
            await action({
              ...f,
              expected: f.expected === 'true',
              expiresAt: new Date(f.expiresAt).toISOString(),
            });
          })
        }
      >
        {pending ? 'Saving…' : 'Add exception'}
      </button>
    </div>
  );
}
