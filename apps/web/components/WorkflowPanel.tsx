'use client';

import { useTransition } from 'react';
import {
  acceptRisk,
  assignIncident,
  clearAcceptedRisk,
  commentIncident,
  snoozeIncident,
  unsnoozeIncident,
} from '../lib/workflow-actions';
import type { IncidentWorkflow, UserRole } from '@reconcile/domain';

export function WorkflowPanel({
  id,
  workflow,
  role,
}: {
  id: string;
  workflow: IncidentWorkflow | undefined;
  role: UserRole;
}) {
  const [pending, start] = useTransition();
  const canReview = role === 'reviewer' || role === 'admin';
  const comments = workflow?.comments ?? [];

  return (
    <section className="mt-4 rounded border p-4">
      <h2 className="mb-2 font-medium">Workflow</h2>
      <div className="mb-3 space-y-1 text-sm">
        <div>
          Assignee: <span className="font-mono">{workflow?.assignee ?? '—'}</span>
        </div>
        <div>
          Snoozed until:{' '}
          <span className="font-mono">{workflow?.snoozedUntil ?? '—'}</span>
        </div>
        <div>
          Accepted risk:{' '}
          {workflow?.acceptedRisk ? (
            <span className="font-mono">
              {workflow.acceptedRisk.reason} — {workflow.acceptedRisk.by} at{' '}
              {workflow.acceptedRisk.at}
            </span>
          ) : (
            '—'
          )}
        </div>
      </div>
      {canReview && (
        <div className="space-y-2 text-sm">
          <form
            action={(fd) => start(() => assignIncident(id, String(fd.get('assignee'))))}
            className="flex gap-2"
          >
            <input name="assignee" placeholder="assignee email" className="rounded border px-2 py-1" />
            <button disabled={pending} className="rounded border px-2 py-1 disabled:opacity-50">
              Assign
            </button>
          </form>
          <form
            action={(fd) => start(() => snoozeIncident(id, String(fd.get('until'))))}
            className="flex gap-2"
          >
            <input name="until" type="datetime-local" className="rounded border px-2 py-1" />
            <button disabled={pending} className="rounded border px-2 py-1 disabled:opacity-50">
              Snooze
            </button>
            {workflow?.snoozedUntil && (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(() => unsnoozeIncident(id))}
                className="rounded border px-2 py-1 disabled:opacity-50"
              >
                Unsnooze
              </button>
            )}
          </form>
          <form
            action={(fd) => start(() => acceptRisk(id, String(fd.get('reason'))))}
            className="flex gap-2"
          >
            <input name="reason" required placeholder="accept risk reason" className="rounded border px-2 py-1" />
            <button disabled={pending} className="rounded border px-2 py-1 disabled:opacity-50">
              Accept risk
            </button>
            {role === 'admin' && workflow?.acceptedRisk && (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(() => clearAcceptedRisk(id))}
                className="rounded border px-2 py-1 text-red-700 disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </form>
          <form
            action={(fd) => start(() => commentIncident(id, String(fd.get('text'))))}
            className="flex gap-2"
          >
            <input name="text" required placeholder="comment" className="w-64 rounded border px-2 py-1" />
            <button disabled={pending} className="rounded border px-2 py-1 disabled:opacity-50">
              Comment
            </button>
          </form>
        </div>
      )}
      {comments.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-600">
          {comments.map((c, i) => (
            <li key={i}>
              <span className="font-mono">{c.at}</span> <strong>{c.by}</strong>: {c.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
