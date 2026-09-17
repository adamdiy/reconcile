import type {
  AccountAssessment,
  FeatureEvaluation,
  IntegrityFinding,
  QuantityEvaluation,
} from '@reconcile/domain';

export interface DiffPair {
  accountId: string;
  feature: string;
  before?: FeatureEvaluation | QuantityEvaluation | IntegrityFinding;
  after?: FeatureEvaluation | QuantityEvaluation | IntegrityFinding;
}

export interface AssessmentDiff {
  regressions: DiffPair[];
  fixes: DiffPair[];
  newUnknowns: DiffPair[];
  newlyAssessed: DiffPair[];
  added: DiffPair[];
  removed: DiffPair[];
  unchanged: number;
}

type Kind = 'match' | 'mismatch' | 'unknown' | 'absent';

interface PairRecord {
  accountId: string;
  feature: string;
  kind: Kind;
  raw: FeatureEvaluation | QuantityEvaluation | IntegrityFinding;
}

function pairsOf(a: AccountAssessment): PairRecord[] {
  const out: PairRecord[] = [];
  for (const f of a.features)
    out.push({ accountId: a.accountId, feature: f.feature, kind: f.kind, raw: f });
  for (const q of a.quantityChecks ?? [])
    out.push({
      accountId: a.accountId,
      feature: q.check === 'seats' ? 'seats' : `usage:${q.metric}`,
      kind: q.kind,
      raw: q,
    });
  for (const i of a.integrity ?? [])
    out.push({
      accountId: a.accountId,
      feature: `integrity:${i.kind}`,
      kind: 'mismatch',
      raw: i,
    });
  return out;
}

export function diffAssessments(
  before: AccountAssessment[],
  after: AccountAssessment[],
): AssessmentDiff {
  const beforeMap = new Map<string, PairRecord>();
  const afterMap = new Map<string, PairRecord>();
  for (const a of before) for (const p of pairsOf(a)) beforeMap.set(`${p.accountId}|${p.feature}`, p);
  for (const a of after) for (const p of pairsOf(a)) afterMap.set(`${p.accountId}|${p.feature}`, p);

  const diff: AssessmentDiff = {
    regressions: [],
    fixes: [],
    newUnknowns: [],
    newlyAssessed: [],
    added: [],
    removed: [],
    unchanged: 0,
  };

  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const key of [...keys].sort()) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    const bk: Kind = b?.kind ?? 'absent';
    const ak: Kind = a?.kind ?? 'absent';
    const pair: DiffPair = {
      accountId: (a ?? b)!.accountId,
      feature: (a ?? b)!.feature,
      before: b?.raw,
      after: a?.raw,
    };
    if (bk === ak) {
      diff.unchanged += 1;
      continue;
    }
    if (bk === 'absent') {
      diff.added.push(pair);
      continue;
    }
    if (ak === 'absent') {
      diff.removed.push(pair);
      continue;
    }
    if (ak === 'mismatch') diff.regressions.push(pair);
    else if (bk === 'mismatch' && ak === 'match') diff.fixes.push(pair);
    else if (ak === 'unknown') diff.newUnknowns.push(pair);
    else if (bk === 'unknown' && ak === 'match') diff.newlyAssessed.push(pair);
    else diff.unchanged += 1;
  }
  return diff;
}
