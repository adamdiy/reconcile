import { redirect } from 'next/navigation';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getSession } from '../../../lib/auth';
import type { Notification } from '@reconcile/notify';

function readOutbox(dir: string): Notification[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Notification[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Notification);
    } catch {
      // skip unreadable file
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const dir = path.join(
    process.env.RECONCILE_STATE_DIR ?? path.resolve(process.cwd(), '.reconcile'),
    'outbox',
  );
  const notifications = readOutbox(dir);

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Notification outbox</h1>
      <p className="text-sm text-gray-600">
        What would have been sent — the outbox channel writes one JSON file per notification to{' '}
        <code className="text-xs">{dir}</code>.
      </p>
      <ul className="space-y-3">
        {notifications.map((n, i) => (
          <li key={i} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{n.title}</span>
              <span className="font-mono text-xs text-gray-500">{n.at}</span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-gray-700">{n.body}</pre>
            {n.incident && (
              <p className="mt-1 text-xs text-gray-500">
                incident <code>{n.incident.fingerprint}</code> · {n.incident.checkKind} ·{' '}
                {n.incident.severity}
              </p>
            )}
          </li>
        ))}
        {notifications.length === 0 && (
          <li className="text-sm text-gray-500">
            Nothing sent yet. Add a rule under Settings → Notifications and trigger an incident
            transition.
          </li>
        )}
      </ul>
    </main>
  );
}
