import { revalidatePath } from 'next/cache';
import { sessionWithRole, requireRole } from '../../../../lib/auth';
import { withProject } from '../../../../lib/state';
import { NotificationRuleSchema } from '@reconcile/domain';

async function addRule(formData: FormData) {
  'use server';
  const session = await requireRole('admin');
  const rule = NotificationRuleSchema.parse({
    id: String(formData.get('id')),
    channel: String(formData.get('channel')),
    target: String(formData.get('target') ?? ''),
    checkKinds:
      String(formData.get('checkKinds') ?? 'all') === 'all'
        ? 'all'
        : String(formData.get('checkKinds')).split(',').filter(Boolean),
    minSeverity: String(formData.get('minSeverity') ?? 'low'),
    states: String(formData.get('states') ?? 'confirmed,verified_remediated')
      .split(',')
      .filter(Boolean),
    enabled: formData.get('enabled') === 'on',
  });
  await withProject(session.projectId, async (_s, ps) => ps.upsertNotificationRule(rule));
  revalidatePath('/settings/notifications');
}

async function deleteRule(formData: FormData) {
  'use server';
  const session = await requireRole('admin');
  await withProject(session.projectId, async (_s, ps) =>
    ps.deleteNotificationRule(String(formData.get('id'))),
  );
  revalidatePath('/settings/notifications');
}

export default async function NotificationsSettingsPage() {
  const session = await sessionWithRole('admin');
  if (!session) {
    return (
      <main>
        <h1 className="text-xl font-semibold">403 — Forbidden</h1>
        <p className="text-sm text-gray-600">Notification rules require the admin role.</p>
      </main>
    );
  }
  const rules = await withProject(session.projectId, async (_s, ps) =>
    ps.listNotificationRules(),
  );

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">Notification rules — {session.projectId}</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-gray-500">
            <th className="py-1">id</th>
            <th>channel</th>
            <th>target</th>
            <th>checks</th>
            <th>min severity</th>
            <th>states</th>
            <th>enabled</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-1 font-mono">{r.id}</td>
              <td>{r.channel}</td>
              <td className="font-mono text-xs">{r.target || '(default outbox)'}</td>
              <td className="font-mono text-xs">{r.checkKinds === 'all' ? 'all' : r.checkKinds.join(', ')}</td>
              <td>{r.minSeverity}</td>
              <td className="font-mono text-xs">{r.states.join(', ')}</td>
              <td>{r.enabled ? 'yes' : 'no'}</td>
              <td>
                <form action={deleteRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-red-600 underline">delete</button>
                </form>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-gray-500">
                No rules yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form action={addRule} className="flex flex-wrap items-end gap-3 rounded border p-4 text-sm">
        <label className="flex flex-col">
          id
          <input name="id" required className="rounded border px-1" placeholder="rule_incidents" />
        </label>
        <label className="flex flex-col">
          channel
          <select name="channel" className="rounded border px-1">
            <option value="outbox">outbox</option>
            <option value="slack">slack</option>
            <option value="email">email</option>
          </select>
        </label>
        <label className="flex flex-col">
          target <span className="text-xs text-gray-400">(url / address / env:NAME / blank)</span>
          <input name="target" className="rounded border px-1" />
        </label>
        <label className="flex flex-col">
          check kinds
          <input name="checkKinds" defaultValue="all" className="rounded border px-1" />
        </label>
        <label className="flex flex-col">
          min severity
          <select name="minSeverity" className="rounded border px-1">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="flex flex-col">
          states
          <input name="states" defaultValue="confirmed,verified_remediated" className="rounded border px-1" />
        </label>
        <label className="flex items-center gap-1">
          <input name="enabled" type="checkbox" defaultChecked /> enabled
        </label>
        <button className="rounded bg-blue-600 px-3 py-1 text-white">Add rule</button>
      </form>
      <p className="text-xs text-gray-500">
        Slack targets may reference <code>env:SLACK_WEBHOOK_URL</code>. The outbox channel writes
        JSON files under the state dir; see <code>/notifications</code>.
      </p>
    </main>
  );
}
