'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export function ProposeRepair({
  incidentId,
  commands,
  action,
}: {
  incidentId: string;
  commands: { id: string; name: string; capabilities: string[] }[];
  action: (
    incidentId: string,
    commandId: string,
    expiresHours: number,
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
}) {
  const [result, setResult] = useState<string | null>(null);
  const { pending } = useFormStatus();
  if (commands.length === 0) return null;
  return (
    <form
      className="flex items-center gap-2 text-sm"
      action={async (fd) => {
        const res = await action(
          incidentId,
          String(fd.get('commandId')),
          Number(fd.get('expiresHours') || 24),
        );
        setResult(res.ok ? `proposed ${res.id}` : (res.error ?? 'failed'));
      }}
    >
      <select name="commandId" className="rounded border px-2 py-1">
        {commands.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        name="expiresHours"
        type="number"
        defaultValue={24}
        min={1}
        className="w-16 rounded border px-2 py-1"
      />
      <span className="text-xs text-gray-500">h</span>
      <button disabled={pending} className="rounded border px-2 py-1 underline">
        Propose repair
      </button>
      {result && <span className="text-xs">{result}</span>}
    </form>
  );
}
