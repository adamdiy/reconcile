'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export function RepairCommandForm({
  action,
}: {
  action: (input: {
    id: string;
    name: string;
    kind: 'http' | 'local_outbox';
    method?: string;
    urlTemplate?: string;
    capabilities: string;
    description?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [kind, setKind] = useState<'http' | 'local_outbox'>('local_outbox');
  const [error, setError] = useState<string | null>(null);
  const { pending } = useFormStatus();
  return (
    <form
      className="grid max-w-xl gap-2 text-sm"
      action={async (fd) => {
        const res = await action({
          id: String(fd.get('id') ?? ''),
          name: String(fd.get('name') ?? ''),
          kind,
          method: String(fd.get('method') ?? ''),
          urlTemplate: String(fd.get('urlTemplate') ?? ''),
          capabilities: String(fd.get('capabilities') ?? ''),
          description: String(fd.get('description') ?? ''),
        });
        setError(res.ok ? null : (res.error ?? 'failed'));
      }}
    >
      <label>
        id <input name="id" placeholder="rc_custom" className="ml-2 rounded border px-2 py-1 font-mono" />
      </label>
      <label>
        name <input name="name" required className="ml-2 rounded border px-2 py-1" />
      </label>
      <label>
        kind{' '}
        <select value={kind} onChange={(e) => setKind(e.target.value as 'http' | 'local_outbox')} className="ml-2 rounded border px-2 py-1">
          <option value="local_outbox">local_outbox</option>
          <option value="http">http</option>
        </select>
      </label>
      {kind === 'http' && (
        <>
          <label>
            method <input name="method" defaultValue="POST" className="ml-2 rounded border px-2 py-1 font-mono" />
          </label>
          <label>
            url template{' '}
            <input
              name="urlTemplate"
              placeholder="https://env:REPAIR_HOST/grant?key={{idempotencyKey}}"
              className="ml-2 w-96 rounded border px-2 py-1 font-mono"
            />
          </label>
        </>
      )}
      <label>
        capabilities (comma-separated){' '}
        <input name="capabilities" required className="ml-2 rounded border px-2 py-1 font-mono" />
      </label>
      <label>
        description <input name="description" className="ml-2 w-96 rounded border px-2 py-1" />
      </label>
      <button disabled={pending} className="mt-2 w-32 rounded border px-3 py-1 underline">
        save command
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
