import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.RECONCILE_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'reconcile-web-'));

import { runAssessment, withStore } from '../lib/state';

const listRuns = () => withStore((s) => s.forProject('default').listRuns());

describe('runAssessment recording', () => {
  it('records a run only when asked', async () => {
    await runAssessment();
    await runAssessment();
    expect(await listRuns()).toHaveLength(0);
    await runAssessment({ record: true });
    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].counts.population).toBeGreaterThan(0);
  });
});
