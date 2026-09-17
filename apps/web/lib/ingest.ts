import { NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';
import type { AppInventory, StripeInventory } from '@reconcile/domain';
import { loadFixtures } from '@reconcile/fixtures';
import { seedFromFixtures } from '@reconcile/store';
import type { SourceOrigin, SourceSnapshot } from '@reconcile/store';
import { runAssessment, withStore } from './state';

function projectFor(req: NextRequest): string {
  return (
    req.nextUrl.searchParams.get('project') ??
    req.headers.get('x-reconcile-project') ??
    'default'
  );
}

function authorized(req: NextRequest): NextResponse | null {
  const token = process.env.RECONCILE_INGEST_TOKEN;
  if (token) {
    if (req.headers.get('authorization') !== `Bearer ${token}`)
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return null;
  }
  const host = (req.headers.get('host') ?? '').split(':')[0];
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    return NextResponse.json(
      { error: 'RECONCILE_INGEST_TOKEN is unset; ingest is only allowed from localhost' },
      { status: 403 },
    );
  }
  console.warn('RECONCILE_INGEST_TOKEN is unset; accepting ingest from localhost only');
  return null;
}

export async function handleIngest<S extends { observedAt: string }>(
  req: NextRequest,
  side: 'stripe' | 'app',
  schema: z.ZodType<S>,
): Promise<NextResponse> {
  const denied = authorized(req);
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'invalid inventory', issues: parsed.error.issues }, { status: 400 });
  const incoming = parsed.data;

  const projectId = projectFor(req);
  const earlyResponse = await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    const ps = store.forProject(projectId);
    const existing = await ps.getSources();
    if (existing && incoming.observedAt < existing[side].observedAt)
      return NextResponse.json(
        { error: 'stale snapshot', storedObservedAt: existing[side].observedAt },
        { status: 409 },
      );
    const fixtures = loadFixtures();
    const base: SourceSnapshot =
      existing ?? {
        stripe: fixtures.stripe,
        app: fixtures.app,
        importedAt: new Date().toISOString(),
        origin: 'fixtures',
      };
    const origins = {
      stripe: base.origins?.stripe ?? base.origin,
      app: base.origins?.app ?? base.origin,
    };
    const next: SourceSnapshot = {
      ...base,
      stripe: side === 'stripe' ? (incoming as unknown as StripeInventory) : base.stripe,
      app: side === 'app' ? (incoming as unknown as AppInventory) : base.app,
      importedAt: new Date().toISOString(),
      origin: 'connector',
      origins: { ...origins, [side]: 'connector' as SourceOrigin },
    };
    await ps.putSources(next);
    return null;
  });
  if (earlyResponse) return earlyResponse;

  const snap = await runAssessment({ record: true, projectId });
  return NextResponse.json({
    ok: true,
    runId: `run_${snap.evaluatedAt}`,
    counts: { population: snap.assessments.length },
  });
}
