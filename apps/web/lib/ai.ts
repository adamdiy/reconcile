import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '@reconcile/engine';

/** Cache key: <fingerprint>:<engineVersion>:<sha256 of sorted evidenceIds>. */
export function explanationKey(fingerprint: string, evidenceIds: string[]): string {
  const h = createHash('sha256').update([...evidenceIds].sort().join('\n')).digest('hex');
  return `${fingerprint}:${ENGINE_VERSION}:${h}`;
}
