'use client';

import { useState, useTransition } from 'react';

export function CaptureBaselineForm({
  action,
}: {
  action: (name: string, note: string) => Promise<{ id: string }>;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="mt-4 rounded border p-4">
      <h2 className="mb-2 font-medium">Capture baseline</h2>
      <div className="flex gap-2">
        <input
          className="rounded border px-2 py-1 text-xs"
          placeholder="name (e.g. pre-migration)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border px-2 py-1 text-xs"
          placeholder="note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          disabled={pending || !name.trim()}
          className="rounded bg-slate-700 px-3 py-1 text-sm text-white disabled:opacity-50"
          onClick={() =>
            start(async () => {
              const r = await action(name, note);
              setDone(r.id);
              setName('');
              setNote('');
            })
          }
        >
          {pending ? 'Capturing…' : 'Capture baseline'}
        </button>
      </div>
      {done && <p className="mt-1 text-xs text-green-700">captured {done}</p>}
    </div>
  );
}
