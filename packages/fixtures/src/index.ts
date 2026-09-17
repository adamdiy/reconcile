import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AppInventorySchema,
  IdentityLinkSchema,
  PolicyExceptionSchema,
  PolicySchema,
  StripeInventorySchema,
} from '@reconcile/domain';
import type {
  AppInventory,
  EvaluationInput,
  IdentityLink,
  Policy,
  PolicyException,
  StripeInventory,
} from '@reconcile/domain';
import { z } from 'zod';

export const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');

export const FixturePriceSchema = z.object({
  id: z.string(),
  nickname: z.string().optional(),
  unitAmount: z.number().optional(),
  currency: z.string().optional(),
});
export type FixturePrice = z.infer<typeof FixturePriceSchema>;

export interface FixtureSet {
  stripe: StripeInventory;
  app: AppInventory;
  links: IdentityLink[];
  policy: Policy;
  exceptions: PolicyException[];
  prices: FixturePrice[];
}

function read(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
}

export function loadFixtures(dir: string = fixturesDir): FixtureSet {
  return {
    stripe: StripeInventorySchema.parse(read(dir, 'stripe.json')),
    app: AppInventorySchema.parse(read(dir, 'app.json')),
    links: z.array(IdentityLinkSchema).parse(read(dir, 'links.json')),
    policy: PolicySchema.parse(read(dir, 'policy.json')),
    exceptions: z.array(PolicyExceptionSchema).parse(read(dir, 'exceptions.json')),
    prices: z.array(FixturePriceSchema).parse(read(dir, 'prices.json')),
  };
}

export function toEvaluationInput(fx: FixtureSet, evaluatedAt: string): EvaluationInput {
  return {
    stripe: fx.stripe,
    app: fx.app,
    links: fx.links,
    policy: fx.policy,
    exceptions: fx.exceptions,
    evaluatedAt,
  };
}
