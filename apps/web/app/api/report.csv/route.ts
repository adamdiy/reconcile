import { runAssessment } from '../../../lib/state';
import { coverageIncidents } from '../../../lib/coverage';
import type { Incident } from '../../../lib/incidents';

export const dynamic = 'force-dynamic';

function cell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const snap = await runAssessment();
  const rows: Incident[] = [...snap.incidents, ...coverageIncidents(snap.assessments)];
  const header =
    'fingerprint,accountId,kind,feature,expected,observed,severity,state,createdAt,confirmedAt,resolvedAt,evidenceIds';
  const lines = rows.map((i) =>
    [
      i.id,
      i.accountId,
      i.kind,
      i.feature,
      i.expected,
      i.observed,
      i.severity,
      i.state,
      i.firstSeenAt,
      i.state === 'confirmed' || i.state === 'resolved' ? i.lastConfirmedAt : '',
      i.state === 'resolved' ? i.lastConfirmedAt : '',
      i.evidenceIds.join('|'),
    ]
      .map(cell)
      .join(','),
  );
  return new Response([header, ...lines].join('\n') + '\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8' },
  });
}
