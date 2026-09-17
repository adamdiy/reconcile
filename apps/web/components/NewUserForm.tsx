'use client';

import { useState } from 'react';

export function NewUserForm({
  projects,
  action,
}: {
  projects: string[];
  action: (input: {
    email: string;
    password: string;
    role: 'viewer' | 'reviewer' | 'admin';
    projectIds: string[];
  }) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(['default']);
  return (
    <form
      action={async (fd) => {
        await action({
          email: String(fd.get('email')),
          password: String(fd.get('password')),
          role: String(fd.get('role')) as 'viewer' | 'reviewer' | 'admin',
          projectIds: selected,
        });
      }}
      className="space-y-2 text-sm"
    >
      <div className="flex gap-2">
        <input name="email" type="email" required placeholder="email" className="rounded border px-2 py-1" />
        <input name="password" type="password" required placeholder="password" className="rounded border px-2 py-1" />
        <select name="role" defaultValue="viewer" className="rounded border px-2 py-1">
          <option value="viewer">viewer</option>
          <option value="reviewer">reviewer</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        {projects.map((p) => (
          <label key={p} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) =>
                setSelected(
                  e.target.checked ? [...selected, p] : selected.filter((x) => x !== p),
                )
              }
            />
            <span className="font-mono">{p}</span>
          </label>
        ))}
        <button className="rounded bg-blue-600 px-3 py-1 text-white">Add</button>
      </div>
    </form>
  );
}
