import type { AssessmentDiff, DiffPair } from '@reconcile/core';

function kindOf(v: DiffPair['before']): string {
  if (!v) return 'absent';
  if ('localRecordIds' in v) return 'mismatch';
  return v.kind;
}

function PairTable({ title, pairs }: { title: string; pairs: DiffPair[] }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium text-gray-500">
        {title} ({pairs.length})
      </h4>
      {pairs.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-0.5 pr-2">account</th>
              <th className="py-0.5 pr-2">feature</th>
              <th className="py-0.5 pr-2">before</th>
              <th className="py-0.5 pr-2">after</th>
              <th className="py-0.5">reason</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr key={i} className="border-b">
                <td className="py-0.5 pr-2 font-mono">{p.accountId}</td>
                <td className="py-0.5 pr-2 font-mono">{p.feature}</td>
                <td className="py-0.5 pr-2">{kindOf(p.before)}</td>
                <td className="py-0.5 pr-2">{kindOf(p.after)}</td>
                <td className="py-0.5 text-gray-500">
                  {(p.after && 'reasons' in p.after ? p.after.reasons?.join(',') : '') ??
                    (p.before && 'reasons' in p.before ? p.before.reasons?.join(',') : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function DiffSummary({ diff }: { diff: AssessmentDiff }) {
  const rows: [string, number][] = [
    ['regressions', diff.regressions.length],
    ['fixes', diff.fixes.length],
    ['newly unknown', diff.newUnknowns.length],
    ['newly assessed', diff.newlyAssessed.length],
    ['pairs added', diff.added.length],
    ['pairs removed', diff.removed.length],
    ['unchanged', diff.unchanged],
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-3 text-xs">
        {rows.map(([label, n]) => (
          <span
            key={label}
            className={
              label === 'regressions' && n > 0
                ? 'rounded bg-red-100 px-2 py-0.5 text-red-800'
                : 'rounded bg-gray-100 px-2 py-0.5'
            }
          >
            {label}: {n}
          </span>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        <PairTable title="Regressions" pairs={diff.regressions} />
        <PairTable title="Fixes" pairs={diff.fixes} />
        <PairTable title="Newly unknown" pairs={diff.newUnknowns} />
        <PairTable title="Newly assessed" pairs={diff.newlyAssessed} />
        <PairTable title="Added" pairs={diff.added} />
        <PairTable title="Removed" pairs={diff.removed} />
      </div>
    </div>
  );
}
