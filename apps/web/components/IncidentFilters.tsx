'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const CHECKS = ['expected_feature_missing', 'unexpected_feature_enabled', 'duplicate_local_identity', 'coverage_gap', 'monitoring_health'];
const SEVERITIES = ['high', 'medium', 'low'];
const STATES = ['candidate', 'confirmed', 'resolved'];

export function IncidentFilters() {
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/incidents?${next.toString()}`);
  }

  const select = (key: string, options: string[], label: string) => (
    <label className="flex items-center gap-1 text-sm">
      {label}
      <select
        className="rounded border px-1 py-0.5"
        value={params.get(key) ?? ''}
        onChange={(e) => setParam(key, e.target.value)}
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="mb-4 flex gap-4">
      {select('check', CHECKS, 'check')}
      {select('severity', SEVERITIES, 'severity')}
      {select('state', STATES, 'state')}
    </div>
  );
}
