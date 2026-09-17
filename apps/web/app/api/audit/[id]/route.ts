import { diffAssessments } from '@reconcile/core';
import type { DiffPair } from '@reconcile/core';
import { getSession } from '../../../../lib/auth';
import { runAssessment, withStore } from '../../../../lib/state';

export const dynamic = 'force-dynamic';

function esc(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(category: string, p: DiffPair): string {
  const kind = (v: DiffPair['before']) =>
    !v ? 'absent' : 'localRecordIds' in v ? 'mismatch' : v.kind;
  return [category, p.accountId, p.feature, kind(p.before), kind(p.after)]
    .map(esc)
    .join(',');
}

export async function GET(req: Request) {
  // Route is /api/audit/<id>.csv — the .csv suffix isn't a valid param name,
  // so the id is taken from the URL tail.
  const tail = new URL(req.url).pathname.split('/').pop() ?? '';
  const id = tail.replace(/\.csv$/, '');
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const baseline = await withStore(async (store) =>
    store.forProject(session.projectId).getBaseline(id),
  );
  if (!baseline) return new Response('not found', { status: 404 });
  const snap = await runAssessment({ projectId: session.projectId });
  const diff = diffAssessments(baseline.assessments, snap.assessments);
  const lines = [
    'category,account,feature,before,after',
    ...diff.regressions.map((p) => row('regression', p)),
    ...diff.fixes.map((p) => row('fix', p)),
    ...diff.newUnknowns.map((p) => row('new_unknown', p)),
    ...diff.newlyAssessed.map((p) => row('newly_assessed', p)),
    ...diff.added.map((p) => row('added', p)),
    ...diff.removed.map((p) => row('removed', p)),
  ];
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv',
      'content-disposition': `attachment; filename="audit-${id}.csv"`,
    },
  });
}
